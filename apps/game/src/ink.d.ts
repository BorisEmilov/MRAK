/** `.ink` stories are compiled to Ink JSON text by build/ink-plugin.ts. */
declare module '*.ink' {
  const json: string;
  export default json;
}
