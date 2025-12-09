// // This file can be replaced during build by using the `fileReplacements` array.
// // `ng build` replaces `environment.ts` with `environment.prod.ts`.
// // The list of file replacements can be found in `angular.json`.

export const environment = {
  production: false,
  apiBaseUrl: 'http://localhost:5017/topology-api', // Docker backend port
  serverurl: 'http://localhost:5017',
  lsName: 'iop_logged_in_user',
};

// export const environment = {
//   production: false,
//   lsName: 'iop_logged_in_user',
//   // serverurl: 'http://localhost:8443',
//   serverurl: 'https://itop.alrajhi.bank:8443',
//   // serverurl: 'https://10.110.65.205:8443',
//   // serverurl: 'https://itop.alrajhi.bank:8443',
// };
