/**
 * Browser shim untuk node:crypto agar bundler Vite tidak memunculkan
 * warning externalization saat mengimpor @celyn/shared di sisi frontend.
 */
export default {};
export const createHmac = undefined;
export const timingSafeEqual = undefined;
