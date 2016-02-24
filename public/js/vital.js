/* Variáveis globais */
var mapa, usuario, socket, barraDispositivo, drawControl;
/* Inicializa o mapa */
function vitalInicializar() {
    //Inicializa o sistema de mapas
    mapa = L.map('mapa').setView([-34.397, 150.644], 14);    
	var osmUrl='http://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';
	var osmAttrib='Gustavo Huffenbacher Daud';
	var osm = new L.TileLayer(osmUrl, {minZoom: 8, maxZoom: 17, attribution: osmAttrib});		
	mapa.addLayer(osm);
    //Para o sistema de criação de raio
    var drawnItems = new L.FeatureGroup();
    mapa.addLayer(drawnItems);
    drawControl = new L.Control.Draw({ edit: { featureGroup: drawnItems }, draw: {
        polyline: false, polygon: false, circle: { shapeOptions: { color: "#0033ff", weight: 5 } }, rectangle: false, marker: false
    } });
    
    //Salva referência para a coluna do dispositivo
    barraDispositivo = $(".barraDispositivo");
    //Exibe a localização do usuário
    vitalMinhaLocalizacao();
    //Exibe tela de autenticação se necessário
    vitalAutenticacao();
}
/* Exibe a localização do usuário */
function vitalMinhaLocalizacao() {
    if (mapa) {
        //Tenta obter a geolocalização do usuário
        if (navigator.geolocation) {
            navigator.geolocation.getCurrentPosition(function (position) {
                mapa.panTo([position.coords.latitude, position.coords.longitude]).setZoom(22);
            });
        }
    }
}
/* Retorna um cookie */
function getCookie(name) {
    var value = "; " + document.cookie;
    var parts = value.split("; " + name + "=");
    if (parts.length == 2) return parts.pop().split(";").shift();
}
/* Exibe tela de autenticação se necessário */
function vitalAutenticacao() {
    $.get("/servicos/autenticacao", function (conectado) {
        //Se não estiver conectado exibe a caixa de login
        if (!conectado) {
            var login = $("<div>").prependTo($("body")).load("/servicos/autenticacao/caixa.html", function () {
                $("#vitalLogin").modal({ backdrop: 'static' }).on('hidden.bs.modal', function () {
                    login.remove();
                });
            });
        //Se estiver conectado carrega as informações
        } else {
            //Salva a referência para o usuário e atualiza nome
            usuario = conectado;
            $("#vitalMenuUsuario").html(usuario.dados.name.givenName);
            //Adiciona os dispositivos
            for (var i = 0; i < usuario.dispositivos.length; i++) {
                vitalAdicionarDispositivo(usuario.dispositivos[i])
            }
            //Inicializa o sistema de comunicação
            vitalIO();
        }
    })
}

/* Adicionar um novo dispositivo */
function vitalAdicionarDispositivo(dados) {
    //Url da imagem
    var foto = "/servicos/dispositivo/foto?id=" + dados.MeuID;

    //Cria o marcador
    var retrato = L.icon({ iconUrl: foto, title: dados.MeuNome });
    dados.marcador = L.marker([0, 0], {icon: retrato}).addTo(mapa);
    
    //Obtém a localização
    $.post("/servicos/dispositivo/localizacao", { id: dados.MeuID }, vitalGPSDispositivo);
  
    //Adiciona uma entrada de menu
    var dispositivo = $("<li></li>");
    var link = $("<a class='vitaldispositivo'/>").data("dados", dados).html(dados.MeuNome).appendTo(dispositivo);
    var img = $("<div></div>").css("background-image", "url('" + foto + "')").addClass("pull-right retrato").appendTo(link);
    dispositivo.insertBefore($("#VitalDispositivos > li:last-child"));

    //Ao clicar no link
    link.on("click", function () {
        vitalExibirBarraDispositivo(dados);
        mapa.panTo(dados.marcador.getLatLng());
    })
}

/* Exibe o editor para escolher um raio no mapa */
function vitalEscolherRaio(_lat, _long, _raio, callback) {

    //Prepara os elementos visuais
    var fundo = $(".modal-backdrop").hide();
    var caixa = $(".modal").hide();
    var nav = $(".navbar").hide();
    var barra = $(".barraDispositivo").hide();
    var fechar = $(".fecharRaio").show();
    var limpar = fechar.find("#Limpar");
    $(".main").addClass("semmargem");
    var raio = null;

    //Cria a forma
    if (_lat != undefined) {
        mapa.panTo([_lat, _long]);
        raio = L.circle([_lat, _long], _raio).addTo(mapa);
        limpar.show();
    }

    //Exibe o editor
    mapa.addControl(drawControl);
    

    //Ao criar um novo círculo
    mapa.on("draw:created", function(e) {
       if (raio) { mapa.removeLayer(raio) }
       var type = e.layerType
       raio = e.layer;
       mapa.addLayer(raio); 
    });
    /* google.maps.event.addListener(editor, 'overlaycomplete', function (e) {
        raio = e.overlay;
        editor.setDrawingMode(null);
        editor.setOptions({ drawingControlOptions: { drawingModes: [], position: google.maps.ControlPosition.TOP_CENTER } });
        limpar.show();
    }); */
    //Função para reexibir os elementos visuais
    var reexibir = function () {
        if (raio) { mapa.removeLayer(raio) }
        mapa.removeControl(drawControl);
        fundo.show();
        caixa.show();
        nav.show();
        barra.show();
        fechar.hide();
        $(".main").removeClass("semmargem");
    }
    //Botões
    fechar.find("#Salvar").click(function () {
        if (!raio) {
            alert("Não é possível salvar pois você não desenhou nenhum raio.");
            return;
        }
        reexibir();
        callback(raio.getLatLng().lat, raio.getLatLng().lng, raio.getRadius());
    });
    fechar.find("#Limpar").click(function () {
        if (raio) { mapa.removeLayer(raio); }
        raio = null;
        limpar.hide();

    });
    fechar.find("#Cancelar").click(reexibir);
}

/* Exibe a janela para criar ou editar um alerta */
function vitalCriarEditarAlerta(entrada, callback) {
    var janela = $("<div>").prependTo($("body")).load("/servicos/alertas/editor.html", function () {
        //Inicializa variáveis
        var lat = undefined;
        var long = undefined;
        var raio = undefined;
        var caixa = $("#vitalAlerta").modal({ backdrop: 'static' }).on('hidden.bs.modal', function () {
            $(".pac-container").remove();
            janela.remove();
        });

        //Verifica se é verdadeiro
        var verdadeiro = function (valor) { return (valor == true) || (valor == "true")}

        //Se houver dados de entrada atualiza os campos
        if (entrada) {
            caixa.find("#alerta-nome").val(entrada.nome);
            if (verdadeiro(entrada.dias.todos)) { caixa.find("#alerta-dias-todos").attr("checked", "checked") }
            if (verdadeiro(entrada.dias.segunda)) { caixa.find("#alerta-dias-segunda").attr("checked", "checked") }
            if (verdadeiro(entrada.dias.terca)) { caixa.find("#alerta-dias-terça").attr("checked", "checked") }
            if (verdadeiro(entrada.dias.quarta)) { caixa.find("#alerta-dias-quarta").attr("checked", "checked") }
            if (verdadeiro(entrada.dias.quinta)) { caixa.find("#alerta-dias-quinta").attr("checked", "checked") }
            if (verdadeiro(entrada.dias.sexta)) { caixa.find("#alerta-dias-sexta").attr("checked", "checked") }
            if (verdadeiro(entrada.dias.sabado)) { caixa.find("#alerta-dias-sábado").attr("checked", "checked") }
            if (verdadeiro(entrada.dias.domingo)) { caixa.find("#alerta-dias-domingo").attr("checked", "checked") }
            caixa.find("#alerta-horario").val(entrada.horario);
            caixa.find("#alerta-quando").val(entrada.condicao.quando);
            lat = parseFloat(entrada.condicao.lat);
            long = parseFloat(entrada.condicao.long);
            raio = parseFloat(entrada.condicao.raio);
            caixa.find("#alerta-endereço").val(entrada.condicao.endereco);
            caixa.find("#alerta-método").val(entrada.tipo.metodo);
            caixa.find("#alerta-destino").val(entrada.tipo.destino);
            caixa.find("#alerta-mensagem").val(entrada.tipo.mensagem);
        } else {
            //Por padrão marca para alertar todos os dias
            caixa.find("#alerta-dias-todos").attr("checked", "checked")
        }

        //Exibe ou esconde a caixa com região
        caixa.find("#alerta-quando").change(function () {
            caixa.find("#caixalocal").toggle($(this).val() != "desconhecida");
        });
        //Exibe (ou esconde) e ajusta a caixa de método
        caixa.find("#alerta-método").change(function () {
            switch ($(this).val()) {
                case "sms":
                    caixa.find("#caixa-destino").show().find("label").html("Telefone");
                    caixa.find("#alerta-destino").attr("placeholder", "DDD País e Telefone (exemplo: 5511980179773)");
                    break;
                case "email":
                    caixa.find("#caixa-destino").show().find("label").html("E-mail");
                    caixa.find("#alerta-destino").attr("placeholder", "ex: nome@provedor.com.br");
                    break;
                case "push":
                    caixa.find("#caixa-destino").hide();
                    break;
            }
        }).change();
        //Botão de escolher GPS
        caixa.find("#alerta-gps").click(function () {
            vitalEscolherRaio(lat, long, raio, function (_lat, _long, _raio) {
                lat = _lat;
                long = _long;
                raio = _raio;
                caixa.find("#alerta-endereço").val("Latitude: " + lat + ", longitude: " + long + ", raio: " + _raio);
            });
        });
        //Auto completar usando o google maps
        var autocomplete = new google.maps.places.Autocomplete(caixa.find("#alerta-endereço")[0]);
        google.maps.event.addListener(autocomplete, 'place_changed', function () {
            lat = autocomplete.getPlace().geometry.location.lat();
            long = autocomplete.getPlace().geometry.location.lng();
            raio = 90;
        });

        //Salvando
        caixa.find("#alerta-salvar").click(function () {
            //Verifica se a descrição foi preenchida
            if (caixa.find("#alerta-nome").val() == "") {
                caixa.find("#tabNome").tab("show");
                caixa.find("#alerta-nome").focus();
                alert("Você deve preencher o campo 'Nome de descrição do alerta' para poder salvar.");
                return;
            }
            //Verifica se a localização foi definida
            if (caixa.find("#caixalocal").is(":visible") && (lat == undefined)) {
                caixa.find("#tabCondição").tab("show");
                caixa.find("#alerta-endereço").focus();
                alert("Você deve preencher o campo 'Região' para poder salvar.");
                return;
            }
            //Verifica se o destino do alerta foi definido
            if (caixa.find("#alerta-destino").is(":visible") && (caixa.find("#alerta-destino").val() == "")) {
                caixa.find("#tabTipo").tab("show");
                caixa.find("#alerta-destino").focus();
                alert("Você deve preencher o campo '" + caixa.find("#alerta-destino").parent().find("label").html() +
                    "' para poder salvar.");
                return;
            }
            //Verifica se a mensagem do alerta foi definida
            if (caixa.find("#alerta-mensagem").val() == "") {
                caixa.find("#tabTipo").tab("show");
                caixa.find("#alerta-mensagem").focus();
                alert("Você deve preencher o campo 'Mensagem' para poder salvar.");
                return;
            }
            //Preenche o objeto
            var entrada = {
                nome: caixa.find("#alerta-nome").val(),
                timezoneOffset: new Date().getTimezoneOffset(),
                dias: {
                    todos: caixa.find("#alerta-dias-todos").is(":checked"),
                    segunda: caixa.find("#alerta-dias-segunda").is(":checked"),
                    terca: caixa.find("#alerta-dias-terça").is(":checked"),
                    quarta: caixa.find("#alerta-dias-quarta").is(":checked"),
                    quinta: caixa.find("#alerta-dias-quinta").is(":checked"),
                    sexta: caixa.find("#alerta-dias-sexta").is(":checked"),
                    sabado: caixa.find("#alerta-dias-sábado").is(":checked"),
                    domingo: caixa.find("#alerta-dias-domingo").is(":checked"),
                }, horario: caixa.find("#alerta-horario").val(),
                condicao: {
                    quando: caixa.find("#alerta-quando").val(),
                    endereco: caixa.find("#alerta-endereço").val(),
                    lat: lat,
                    long: long,
                    raio: raio
                },
                tipo: {
                    metodo: caixa.find("#alerta-método").val(),
                    destino: caixa.find("#alerta-destino").val(),
                    mensagem: caixa.find("#alerta-mensagem").val()
                }
            };
            callback(entrada);
            $(".modal").modal("hide");
        });

    });
}

/* Adiciona uma linha representando um alerta */
function vitalEntradaAlerta(id, entradas, entrada) {

    //Para salvar
    var salvar = function () {
        $.post("/servicos/monitor/salvaralertas", {
            idMonitor: usuario._id, idDispositivo: id,
            alertas: entradas
        });
    }

    var alerta = $("<div class='alerta'></div>").append($("<div/>").html(entrada.nome));
    var editar = $("<button class='btn btn-default'/>")
        .append("<span class='glyphicon glyphicon-pencil'></span>").appendTo(alerta).click(function () {
            vitalCriarEditarAlerta(entrada, function (_entrada) {
                $.extend(entrada, _entrada);
                alerta.find("div").html(entrada.nome);
                salvar();
            });
        });
    var remover = $("<button class='btn btn-danger'/>").css("margin-left", "5px")
        .append("<span class='glyphicon glyphicon-remove'></span>").appendTo(alerta).click(function () {
            if (!confirm("Você tem certeza que deseja apagar este alerta ?")) { return; }
            alerta.remove();
            var indice = -1;
            for (var i = 0; i < entradas.length; i++) {
                if (entradas[i] == entrada) { indice = i }
            }
            entradas.splice(indice, 1);
            salvar();
        });
    barraDispositivo.find("#alertas").append(alerta);
}

/* Exibe a barra de dispositivo */
function vitalExibirBarraDispositivo(dados) {
    //Exibe a barra
    barraDispositivo.animate({ width: 220 }).data("dados", dados);

    //Esconde a navbar caso esteja em modo de largura reduzida
    $(".navbar-collapse.collapse.in").removeClass("in");

    //Prepara os campos
    barraDispositivo.find("#nome").html(dados.MeuNome);
    barraDispositivo.find("#enviarmensagem").off("click").on("click", function () {
        var mensagem = prompt("Digite a mensagem que deseja enviar:", "");
        if (mensagem != undefined && mensagem != "") {
            $.post("/servicos/dispositivo/push", { id: dados.MeuID, mensagem: mensagem });
            alert("Mensagem enviada");
        }
    });

    //Lista de alertas
    barraDispositivo.find("#alertas").empty();
    if (dados.alertas != null) {
        for (var i = 0; i < dados.alertas.length; i++) {
            vitalEntradaAlerta(dados.MeuID, dados.alertas, dados.alertas[i]);
        }
    }

    //Ação do botão de criar alertas
    barraDispositivo.find("#criaralerta").off("click").on("click", function ()
    {
        //Abre a tela para crar uma nova entrada
        vitalCriarEditarAlerta(null, function (entrada) {
            if (dados.alertas == null) { dados.alertas = []; }
            dados.alertas.push(entrada);
            $.post("/servicos/monitor/salvaralertas", {
                idMonitor: usuario._id, idDispositivo: dados.MeuID,
                alertas: dados.alertas
            });
            vitalEntradaAlerta(dados.MeuID, dados.alertas, entrada);
        });
    });

    //Quando clicar fora esconde
    $("body").off("mousedown").on("mousedown", function (e) {
        if (!barraDispositivo.is(":hover") && !$(".modal-dialog").is(":visible") && !$(".fecharRaio").is(":visible")) {
            //Esconde a barra
            $(this).off(e);
            barraDispositivo.animate({ width: 0 });
        }
        e.stopPropagation();
    });
}

/* Alteração de GPS do dispositivo */
function vitalGPSDispositivo(dados) {
    if (!dados) return;
    $(".vitaldispositivo").each(function () {
        var entrada = $(this).data("dados");
        if (entrada.MeuID == dados.MeuID) {
            entrada.marcador.setLatLng( [ dados.lat, dados.long ]);

            //Se a barra de dispositivo for referente ao marcador, centraliza o mapa
            if ((barraDispositivo.width() > 0) && (barraDispositivo.data("dados").MeuID == dados.MeuID)) {
                mapa.panTo([dados.lat, dados.long]);
            }

        }
    });
}

/* Exibe uma caixa de alerta */
function vitalAlerta(titulo, corpo) {
    var alerta = $("<div>").prependTo($("body")).load("/alerta.html", function () {
        $("#vitalAlerta").html($("#vitalAlerta").html()
            .replace("#TÍTULO", titulo)
            .replace("#CORPO", corpo))
            .modal({ backdrop: 'static' }).on('hidden.bs.modal', function () {
                alerta.remove();
            });
    });
}
/* Inicializa a conexão */
function vitalIO() {
    var socket = io.connect('//' + window.location.hostname);
    //Quando um novo usuário foi registrado
    socket.on("registrado", function (dados) {
        //Fecha as janelas
        $('.modal').modal('hide');
        vitalAdicionarDispositivo(dados);
        vitalAlerta("Monitorar novo dispositivo", "O usuário " + dados.MeuNome + " foi registrado");
    });
    //Quando houve alteração de gps
    socket.on("gps", vitalGPSDispositivo);
}

/* Exibe a tela para monitorar um novo usuário */
function vitalMonitorarAdicionar() {
    var login = $("<div>").prependTo($("body")).load("/servicos/monitorar/adicionar.html", function () {
        $("#vitalMonitorarAdicionarDialogo").modal({ backdrop: 'static' }).on('hidden.bs.modal', function () {
            login.remove();
        });
        $("#vitalMonitorarAdicionar").qrcode({
            render	: "table",
            text	: "VITAL" + usuario._id
        });
    });
}