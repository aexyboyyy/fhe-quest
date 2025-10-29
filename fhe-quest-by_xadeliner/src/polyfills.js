// Polyfill global for browser compatibility with @zama-fhe/relayer-sdk
if (typeof window !== 'undefined') {
    window.global = window;
    global = window;
}
