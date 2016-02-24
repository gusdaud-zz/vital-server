module.exports = {
    //Conexão no express
    express: {
        secret: "a1GB*h4K9",
//        porta: 8080,
        porta: 80
    },
    //Para envio de email
    mailer: {
        host: "mail.kvital.com",
        port: 8889,
        remetente: "postmaster@kvital.com",
        user: "postmaster@kvital.com",
        pass: "vital@"
    },
    //Conta no Twilio
    twilio: {
        AccountSID: "AC25e6ae4a16489796572b360b6b4686e9",
        AuthToken: "6129b0d97449596caceeb1a253fd569d",
        numero: "+12512075564"
    },
    //Conta no Cloudant
    cloudant: {
        account: "59eb693a-f71d-46d3-9fde-b127ea3f805f-bluemix", 
        password: "113c8fa7bac8e68d6a7089f9b8ee81978c46181f898271184a4893d20901776e",
        host: '59eb693a-f71d-46d3-9fde-b127ea3f805f-bluemix.cloudant.com'
    },
    //Conta no Iot Foundations
    iot: {
        "org" : "5xvfkk",
        "host" : "5xvfkk.internetofthings.ibmcloud.com",
        "id" : "a-5xvfkk-3s85sfg0me",
        "auth-key" : "a-5xvfkk-pc28hepgds",
        "auth-token" : "iGKE*sUricUz3kGfvV",
        "auth-base-64": "YS01eHZma2stcGMyOGhlcGdkczppR0tFKnNVcmljVXoza0dmdlY="
    },
    //Conta no facebook
    facebook: {
        facebook_app_id: "870873076358326",
        facebook_app_secret: "49897b6db47d54072e50d055c25bb2e0",
        facebook_callback: "http://vital-app.mybluemix.net/servicos/autenticacao/callback"
        //facebook_callback: "http://192.168.0.109:8080/servicos/autenticacao/callback"
        //facebook_callback: "http://localhost:3000/servicos/autenticacao/callback"
    }
};