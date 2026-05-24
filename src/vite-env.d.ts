/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_ELEVENLABS_API_KEY: string;
  readonly VITE_RPM_API_KEY: string;
  readonly VITE_RPM_SUBDOMAIN: string;
  readonly VITE_AMAP_JS_KEY: string;
  readonly VITE_AMAP_SECURITY_CODE: string;
  readonly VITE_AMAP_WEB_KEY: string;
  readonly VITE_FUNASR_WS_URL: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
