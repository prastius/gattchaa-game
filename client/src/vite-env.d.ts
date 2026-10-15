/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** Optional game server URL, e.g. https://play.example.com (defaults to same origin). */
  readonly VITE_SERVER_URL?: string;
}
