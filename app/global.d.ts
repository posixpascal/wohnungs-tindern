// Ambient module declarations for assets embedded as raw text via
// `import x from "./file.ext" with { type: "text" }` (Bun text loader).
declare module "*.sql" {
  const content: string;
  export default content;
}

declare module "*.html" {
  const content: string;
  export default content;
}

declare module "*.css" {
  const content: string;
  export default content;
}

declare module "*.js" {
  const content: string;
  export default content;
}
