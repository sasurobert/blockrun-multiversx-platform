/**
 * WebUI API Configuration
 * Supports Vercel deployment with VITE_API_BASE_URL (e.g. https://<ip>.sslip.io)
 * or local reverse proxy fallback.
 */
export const API_BASE = (import.meta.env.VITE_API_BASE_URL || "").replace(/\/$/, "");
export const API_BASE_URL = API_BASE;
