/// <reference types="vite/client" />

declare module "*.module.css" {
  const classes: { readonly [key: string]: string };
  export default classes;
}

declare module "*.css";

// The protected brain is plain JS with no type declarations.
declare module "../viz/brain/app.js";
