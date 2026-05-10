declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    // interface Platform {}
  }
}

declare module '*.xml?raw' {
  const content: string
  export default content
}

export {}
