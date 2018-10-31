/* APIs utilizadas */
var cloudant = require("cloudant");
var apn = require('apn');           
var express = require('express');
var app = express();
var http = require('http').Server(app);
var io = require('socket.io')(http);
var bodyParser = require('body-parser');
var cookieSession = require('cookie-session');
var cookieParser = require('cookie-parser');
var passport = require('passport');
var vitalConfig = require('./config.js');
var session = require('express-session');
var connectCouchDB = require('connect-couchdb')(session);
var request = require("request");
var passportSocketIo = require("passport.socketio");
var twilio = require('twilio');
var mailer = require('nodemailer');
var smtpTransport = require('nodemailer-smtp-transport');

/* Vari�veis globais */
var iotClient, dbUpdate, sessionStore, apnDesenvolvimento, apnProducao, twilioClient, mailerTransport;

/* Inicializa o servidor */
function inicializarServidor() {
    //Cria o gerenciador de armazenamento de sess�es
    sessionStore = new connectCouchDB({
        name: 'sessoes',
        reapInterval: 600000,
        compactInterval: 300000,
        setThrottle: 60000,
        username: vitalConfig.cloudant.account, 
        password: vitalConfig.cloudant.password, 
        host: vitalConfig.cloudant.host
    });
    //sessionStore = new session.MemoryStore();

    //Cria o servidor de web e define acesso � pasta public
    app.use(express.static(__dirname + '/public'));
    //app.use(cookieParser());
    //app.use(cookieSession({
    //    name: 'session',
    //    keys: ['key1', 'key2']
    //}));
    app.use(bodyParser.urlencoded({ extended: true }));
    app.use(session({ secret: vitalConfig.express.secret, 
        resave: true, saveUninitialized: true, store: sessionStore}));
    app.use(passport.initialize());
    app.use(passport.session());
    //Inicia o servidor web
    app.set('port', process.env.PORT || 3000);
    http.listen(app.get('port'), '0.0.0.0', function () { 
        console.log("Iniciou servidor na porta " + app.get('port'));
    });
}

/* Inicializa o Cloudant */
function inicializarCloudant() {
    //Acesso ao claudant
    cloudant = cloudant({
        account: vitalConfig.cloudant.account, 
        password: vitalConfig.cloudant.password
    });
    //Fun��o para atualizar
    dbUpdate = function (obj, key, callback) {
        var db = this;
        db.get(key, function (error, existing) {
            if (!error) obj._rev = existing._rev;
            db.insert(obj, key, callback);
        });
    }
}

/* Envia um alerta */
function enviarAlerta(monitorId, dispositivoId, dispositivoInfo, alertaInfo) {
    switch (alertaInfo.tipo.metodo) {
        case "sms":
            enviarSMS(alertaInfo.tipo.destino, alertaInfo.tipo.mensagem);
            break;
        case "email":   
            enviarEmail(alertaInfo.tipo.destino, "Novo alerta do vital", alertaInfo.tipo.mensagem)
            break;
        case "push":
            enviarPush(monitorId, alertaInfo.tipo.mensagem);
            break;
    }
}

/* Verifica um alerta */
function verificarAlerta(monitorId, dispositivoId, dispositivoInfo, alertaInfo) {
    //Verifica se tem pelo menos duas posi��es registradas
    if (dispositivoInfo.historico.length < 2) { return; }
    //Inicializa as vari�veis
    var hoje = new Date();
    hoje.setTime(hoje.getTime() - parseInt(alertaInfo.timezoneOffset, 10));
    //Valida o dia da semana
    var valido = false;
    if ((hoje.getDay() == 0) && (alertaInfo.dias.domingo == "true")) { valido = true }
    if ((hoje.getDay() == 1) && (alertaInfo.dias.segunda == "true")) { valido = true }
    if ((hoje.getDay() == 2) && (alertaInfo.dias.terca == "true")) { valido = true }
    if ((hoje.getDay() == 3) && (alertaInfo.dias.quarta == "true")) { valido = true }
    if ((hoje.getDay() == 4) && (alertaInfo.dias.quinta == "true")) { valido = true }
    if ((hoje.getDay() == 5) && (alertaInfo.dias.sexta == "true")) { valido = true }
    if ((hoje.getDay() == 6) && (alertaInfo.dias.sabado == "true")){ valido = true }
    if (alertaInfo.dias.todos == "true") { valido = true }
    //Valida o hor�rio
    if ((alertaInfo.horario != "qualquer") && (alertaInfo.horario != hoje.getHours() + ":00")) { valido = false }
    //Sa� se n�o passar pela valida��o
    if (!valido) { return; }
    //Fun��o para validar se est� no raio
    function noRaio(checkPoint, centerPoint, km) {
        var ky = 40000 / 360;
        var kx = Math.cos(Math.PI * centerPoint.lat / 180.0) * ky;
        var dx = Math.abs(centerPoint.long - checkPoint.long) * kx;
        var dy = Math.abs(centerPoint.lat - checkPoint.lat) * ky;
        return Math.sqrt(dx * dx + dy * dy) <= km;
    }
    var gpsAlerta = { lat: alertaInfo.condicao.lat, long: alertaInfo.condicao.long };
    var raio = alertaInfo.condicao.raio / 1000;
    var gpsPosicaoAtual = dispositivoInfo.historico[0];
    var gpsPosicaoAnterior = dispositivoInfo.historico[1];
    //Valida condi��o
    switch (alertaInfo.condicao.quando) {
        case "entrou":
            if (!noRaio(gpsPosicaoAnterior, gpsAlerta, raio) && noRaio(gpsPosicaoAtual, gpsAlerta, raio)) { 
                enviarAlerta(monitorId, dispositivoId, dispositivoInfo, alertaInfo)
            }
            break;
        case "saiu":
            if (noRaio(gpsPosicaoAnterior, gpsAlerta, raio) && !noRaio(gpsPosicaoAtual, gpsAlerta, raio)) {
                enviarAlerta(monitorId, dispositivoId, dispositivoInfo, alertaInfo)
            }
            break;
        case "naoesta":
            if (!noRaio(gpsPosicaoAtual, gpsAlerta, raio)) {
                enviarAlerta(monitorId, dispositivoId, dispositivoInfo, alertaInfo)
            }
            break;
        case "desconhecida":
            var agora = new Date();
            var ultima = new Date(gpsPosicaoAtual.atualizacao);
            if (Math.ceil((agora.getTime() - ultima.getTime()) / (1000 * 3600 * 24)) > 1) {
                enviarAlerta(dispositivoId, dispositivoInfo, alertaInfo)
            }
            break;
    }
}

/* Verifica por alertas */
function verificarAlertas(deviceId, info) {
    //Procura pelos monitores
    var monitor = cloudant.use("monitor");
    monitor.search("vital", "possuiAlerta", { q: "dispositivo:" + deviceId + "-", "include_docs":true}, function (err, result) {
        if (err) { console.log("Erro ao procurar os alertas do dispositivo: " + err.message); return; }
        for (var i = 0; i < result.rows.length; i++) {
            for (var j in result.rows[i].doc.dispositivos) {
                if ((result.rows[i].doc.dispositivos[j].MeuID == deviceId) && (result.rows[i].doc.dispositivos[j].alertas)) {
                    for (var k in result.rows[i].doc.dispositivos[j].alertas) {
                        verificarAlerta(result.rows[i].doc._id, deviceId, info, result.rows[i].doc.dispositivos[j].alertas[k]);
                    }
                }
            }
        }
    });

}

/* Evento no iot */
function iotEvento(deviceType, deviceId, eventType, format, payload) {
    //Abre o banco de dados de dispositivos
    var dispositivo = cloudant.use("dispositivo");
    dispositivo.update = dbUpdate;
    var dados = JSON.parse(payload);
    //Se o evento for gps chama a fun��o para atualizar o registro do dispositivo
    if (eventType == "gps") {
        //Atualiza os dados de latitude e longitude
        dispositivo.get(deviceId, function (error, info) {
            if (error == null) {
                //Salva as �ltimas 10 atualiza��es
                if (!info.historico) { info.historico = []; }
                if ((info.historico.length > 0) && (info.historico[0].lat == dados.lat) &&  //Para evitar atualiza��es duplicadas
                    (info.historico[0].long == dados.long)) { return }
                info.historico.unshift({ lat: dados.lat, long: dados.long, atualizacao: new Date().toISOString() });
                if (info.historico.length > 10) { info.historico.length = 10; }
                //Salva no banco de dados
                dispositivo.insert(info, deviceId, function (err) {
                    if (err != null) {
                        console.log("Erro ao atualizar o gps do dispositivo " + deviceId + " na tabela: " + err.message);
                    } else {
                        verificarAlertas(deviceId, info);
                    }
                });
            }
        });
        //Procura pelos monitores
        var monitor = cloudant.use("monitor");
        monitor.search("vital", "sendoMonitorado", { q: "dispositivo:" + deviceId + "-" }, 
            function (err, result) { 
            if (err) { console.log("Erro ao procurar os dispositivos associados: " + err.message); return; }
            for (var i = 0; i < result.rows.length; i++) {
                dados.MeuID = deviceId;
                mensagemUsuario(result.rows[i].id, "gps", dados);
            }
        });
    }
}

/* Inicializa a conex�o com o iot */
function inicializarIot() {
    //Cria a conectividade com o iot
    var iot = require("ibmiotf").IotfApplication;
    var config = {
        "org" : vitalConfig.iot.org,
        "id" : vitalConfig.iot.id,
        "auth-key" : vitalConfig.iot["auth-key"],
        "auth-token" : vitalConfig.iot["auth-token"]
    }
    iotClient = new iot(config);
    iotClient.connect();
    //Conecta com o iot
    iotClient.on("connect", function () {
        //Se inscreve para mudan�a de status
        iotClient.subscribeToDeviceEvents();
    });
    //Quando houver um novo evento
    iotClient.on("deviceEvent", iotEvento);
}

/* Cadastra um novo dispositivo no iot */
function cadastrarIot(id, callback) {
    //Prepara para a chamada
    var options = {
        method: 'POST',
        url: 'https://' + vitalConfig.iot.host + '/api/v0002/device/types/iPhone/devices/',
        headers: {  
            'cache-control': 'no-cache',
            'content-type': 'application/json',
            authorization: 'Basic ' + vitalConfig.iot['auth-base-64']
        },
        body: { deviceId: id },
        json: true
    };
    //Faz a chamada da API
    request(options, function (error, response, body) {
        if (error) throw new Error(error);
        callback(body.authToken);
    });
}

/* Cria ou atualiza monitor */
function criarMonitor(dados, callback) {
    //Abre o banco de dados de monitores
    var monitor = cloudant.use("monitor");
    //Tenta obter a entrada, se n�o existir cria
    monitor.get(dados.id, function (error, info) {
        if (error) {
            info = { _id: dados.id, dispositivos: [], dados: {
                    "displayName": dados.displayName,
                    "name": dados.name,
                    "gender": dados.gender    
            }};
            monitor.insert(info, dados.id, function () { callback(dados.id) })
        } else {
            callback(info._id);
        }
    });
}

/* Envia push para atualizar dispositivo */
function localizacaoDispositivo(req, res) {
    //Salva o id
    var id = req.body["id"];
    //Procura no banco
    var dispositivo = cloudant.use("dispositivo");
    dispositivo.get(id, function(error, info) {
        if (error) {
            res.json(false);
            return;
        }
        //Retorna a localiza��o
        if (!info.historico) { res.json(false) }
        if (info.historico.length == 0) { res.json(false) }
        info = info.historico[0];
        res.json({lat: info.lat, long: info.long, atualizacao: info.atualizacao, MeuID: id});
    })
}

/* Cadastra um novo dispositivo */
function cadastrarDispositivo(req, res) {
    //Salva o id e exibe no log
    var id = req.body["id"];
    var pushToken = req.body["pushToken"];
    
    //Abre o banco de dados de monitores
    var dispositivo = cloudant.use("dispositivo");
    dispositivo.get(id, function (error, info) {
        //Se n�o existir adiciona
        if (error) {
            cadastrarIot(id, function (iotToken) {
                var entrada = { id: id, pushToken: pushToken, iotToken: iotToken };
                dispositivo.insert(entrada, id, function () {
                    //Avisa ao usu�rio e retorna um JSON
                    console.log("Dispositivo " + id + " (push token: " + pushToken + ", " +
                        "iot token:" + iotToken + ") cadastrado");
                    res.json(entrada.iotToken);
                });
            })
        //Existe, atualiza
        } else {
            info.pushToken = pushToken;
            console.log("Dispositivo " + id + " re-autenticado (push token: " + pushToken + ")");
            dispositivo.insert(info, id, function (err) { 
                if (err) { console.log("Erro ao re-autenticar: " + err.message); }
            });
            res.json(info.iotToken);
        }
    });
}

/* Registra um novo dispositivo */
function registrarDispositivo(req, res) {
    //Obt�m as vari�veis da requisi��o
    var MonitorID = req.body["MonitorID"];
    var MeuID = req.body["MeuID"];
    var MeuNome = req.body["MeuNome"];
    
    //Abre o banco de dados de monitores
    var monitor = cloudant.use("monitor");
    monitor.get(MonitorID, function (error, info) {
        //Valida e j� existe
        var existe = false
        info.dispositivos.forEach(function (e) { if (e.MeuID == MeuID) { existe = true } });
        if (existe) {
            res.json(false);
            return;
        }
        //Se n�o existir adiciona na lista
        var entrada = { MeuID: MeuID, MeuNome: MeuNome };
        info.dispositivos.push(entrada);
        monitor.insert(info, MonitorID, function () {
            //Avisa ao usu�rio e retorna
            console.log("Usuario " + MeuNome + " (" + MeuID + ") registrado");
            mensagemUsuario(MonitorID, "registrado", entrada);
            res.json(true);       
        });
    });

}

/* Retorna informa��es de autentica��o de dispositivo */
function autenticacaoDispositivo(req, res) {
    var monitor = cloudant.use("monitor");
    if (req.user) {
        monitor.get(req.user, function (error, dados) {
            if (error != null) {
                console.log("Erro ao verificar autenticacao: " + error.message);
                res.json(false);
                return;
            }
            res.json(dados);
        });
    } else {
        res.json(false);
    }
}

/* Envia uma mensagem push para um dispositivo */
function pushDispositivo(req, res) {
    var id = req.body["id"];
    var mensagem = req.body["mensagem"];
    enviarPush(id, mensagem);
}

/* Salva os alertas */
function salvarAlertas(req, res) {
    var idMonitor = req.body["idMonitor"];
    var idDispositivo = req.body["idDispositivo"];
    var alertas = req.body["alertas"];
    //Abre o banco de dados de monitores
    var monitor = cloudant.use("monitor");
    monitor.get(idMonitor, function (error, dados) {
        for (var i = 0; i < dados.dispositivos.length; i++) {
            if (dados.dispositivos[i].MeuID == idDispositivo) {
                dados.dispositivos[i].alertas = alertas;
            }
        }
        monitor.insert(dados, idMonitor);
    });
    res.json(true);
}

/* Retorna a foto do dispositivo */
function fotoDispositivo(req, res) {
    request('http://graph.facebook.com/' + req.query.id + '/picture?type=small').pipe(res);
}

/* Inicializa o sistema de autentica��o */
function inicializarAutenticacao() {
    //M�todos de serializa��o do usu�rio
    passport.serializeUser(function (user, done) { done(null, user); });
    passport.deserializeUser(function (user, done) { done(null, user); });
    //Cria o objeto de autentica��o
    var FacebookStrategy = require('passport-facebook').Strategy;
    passport.use(new FacebookStrategy({
        clientID: vitalConfig.facebook.facebook_app_id,
        clientSecret: vitalConfig.facebook.facebook_app_secret,
        callbackURL: vitalConfig.facebook.facebook_callback
    },
    function (accessToken, refreshToken, profile, done) {
        criarMonitor(profile, function (dados) { done(null, dados) })        
    }));
    //URL de autentica��o
    app.get("/servicos/autenticacao/entrar", passport.authenticate('facebook', { scope: ["email"] }));
    //URL de sa�da
    app.get("/servicos/autenticacao/sair", function (req, res) {
        req.logout();
        res.redirect("/");
    });
    //Callback de autentica��o
    app.get('/servicos/autenticacao/callback',
      passport.authenticate('facebook', {
            successRedirect: '/',
            failureRedirect: '/?err'
        }));        
    //Se estiver autenticado retorna os dados do usu�rio, caso contr�rio retorna false
    app.get("/servicos/autenticacao", autenticacaoDispositivo);
    //Registrar monitoramento
    app.post("/servicos/monitor/registrardispositivo", registrarDispositivo);
    app.post("/servicos/monitor/salvaralertas", salvarAlertas);
    app.post("/servicos/dispositivo/push", pushDispositivo);
    app.post("/servicos/dispositivo/cadastrar", cadastrarDispositivo);
    app.post("/servicos/dispositivo/localizacao", localizacaoDispositivo);
    app.get("/servicos/dispositivo/foto", fotoDispositivo);
}

/* Envia um push para um usu�rio */
function enviarPush(id, alerta) {
    //Primeiro obt�m o token do banco de dados
    var dispositivo = cloudant.use("dispositivo");
    dispositivo.get(id, function (error, dados) {
        //Caso ocorreu um erro
        if (error != null) { return }
        //Prepara a notifica��o
        var dispositivo = new apn.Device(dados.pushToken);
        console.log(dados.pushToken);
        var notificacao = new apn.Notification();
        notificacao.expiry = Math.floor(Date.now() / 1000) + 3600;
        notificacao.alert = alerta;
        apnDesenvolvimento.pushNotification(notificacao, dispositivo);
        apnProducao.pushNotification(notificacao, dispositivo);
        console.log("Enviado um push para o ID " + id + " (" + alerta + ")");
    });
}

/* Envia mensagem para usu�rio */
function mensagemUsuario(id, mensagem, dados) {
    passportSocketIo.filterSocketsByUser(io, function (user) {
        return user === id;
    }).forEach(function (socket) {
        socket.emit(mensagem, dados);
        console.log("Mensagem para " + id);
    });
}

/* Inicializa o sistema de comunica��o */
function inicializarIO() {
    //Conex�o entre o passport e o SocketIO
    io.use(passportSocketIo.authorize({
        cookieParser: cookieParser, key: 'connect.sid',                         
        secret: vitalConfig.express.secret, store: sessionStore,
        fail: function (data, message, error, accept) {
            console.log("Erro na conexao com o SocketIO: (" + message.replace(/\n|\r/g, "") + ")");
            accept(null, false);
        }
    }));
    //Usu�rio se conectou
    io.on('connection', function (socket) {
        console.log("Conectado com socketIO");
    })
};

/* Inicializa o sistema de push */
function inicializarPush() {
 
    //Inicializa o objeto para envio de push de produção
    var opcoes = { cert: "apn/cert-production.pem", 
        key: "apn/key-production.pem", production: true,
        "batchFeedback": true, "interval": 300 };
    apnProducao = new apn.Connection(opcoes); 
    var feedbackProducao = new apn.Feedback(opcoes);
    feedbackProducao.on("feedback", function(devices) {
        devices.forEach(function(item) {
            console.log("Log do APN de producao:");
            console.log(item);
        });
    });
    
    //Inicializa o objeto para o envio de push de modo de desenvolvimento
    opcoes.cert = "apn/cert-development.pem";
    opcoes.key = "apn/key-development.pem";
    opcoes.production = false;
    apnDesenvolvimento = new apn.Connection(opcoes); 
    var feedbackDesenvolvimento = new apn.Feedback(opcoes);
    feedbackDesenvolvimento.on("feedback", function(devices) {
        devices.forEach(function(item) {
            console.log("Log do APN de desenvolvimento:");
            console.log(item);
        });
    });
}

/* Tenta inicializar o push */
function tentarInicializarPush() {
    try {
        inicializarPush();
    } catch (error) {
        console.log('Não foi possível inicializar o push');
    }
}

/* Inicializa o twilio */
function inicializarTwilio() {
    twilioClient = new twilio.RestClient(vitalConfig.twilio.AccountSID, vitalConfig.twilio.AuthToken);
}
/* Envia uma mensagem SMS */
function enviarSMS(destino, mensagem) {
    twilioClient.sendSms({
        to: "+" + destino,
        from: vitalConfig.twilio.numero,
        body: mensagem
    }, function (error, message) {
        if (!error) {
            console.log("Mensagem '" + mensagem + "' enviada para " + destino);
        } else {
            console.log("Erro ao enviar mensagem para " + destino);
        }
    });
}

/* Envia um email */
function enviarEmail(destino, assunto, corpo) {
    var mailOptions = {
        from: vitalConfig.mailer.remetente, // sender address
        to: destino, // list of receivers
        subject: assunto, // Subject line
        text: corpo, // // plaintext body
        html: "<h2>" + assunto + "</h2>" + corpo // You can choose to send an HTML body instead
    };
    mailerTransporter.sendMail(mailOptions, function (error, info) {
        if (error) {
            console.log("Erro ao enviar e-mail para " + destino);
        } else {
            console.log("E-mail '" + corpo + "' enviado para " + destino);
        };
    });
}

/* Inicializa o mailer */
function inicializarMailer() {
    mailerTransporter = mailer.createTransport(smtpTransport({
        host: vitalConfig.mailer.host,
        port: vitalConfig.mailer.port,
        auth: {
            user: vitalConfig.mailer.user,
            pass: vitalConfig.mailer.pass
        },
        tls: { rejectUnauthorized: false },
        debug: true
    })
    );
}

/* Verifica��es e ajustes para localhost */
function verificarLocalhost() {
    if (process.env.USERNAME == 'Gustavo') {
        console.log("Executando em localhost");
        process.env.PORT = 8080;
        vitalConfig.facebook.facebook_callback = "http://localhost:" + 
            process.env.PORT + "/servicos/autenticacao/callback";
    }
}

/* Inicializa */
verificarLocalhost();
inicializarCloudant();
inicializarIot();
inicializarServidor();
inicializarAutenticacao();
inicializarIO();
// tentarInicializarPush();
inicializarTwilio();
inicializarMailer();