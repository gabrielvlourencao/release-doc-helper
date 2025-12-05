// Copie este arquivo para environment.ts e environment.prod.ts
// e preencha com suas credenciais do Firebase e GitHub

export const environment = {
  production: false,
  firebase: {
    apiKey: "SUA_API_KEY",
    authDomain: "SEU_PROJETO.firebaseapp.com",
    projectId: "SEU_PROJETO",
    storageBucket: "SEU_PROJETO.firebasestorage.app",
    messagingSenderId: "SEU_MESSAGING_SENDER_ID",
    appId: "SEU_APP_ID",
    measurementId: "SEU_MEASUREMENT_ID"
  },
  github: {
    clientId: "SEU_GITHUB_CLIENT_ID", // Obtenha em: https://github.com/settings/developers
    apiUrl: "http://localhost:3000/api/github" // URL da sua API backend para trocar código por token
  }
};

