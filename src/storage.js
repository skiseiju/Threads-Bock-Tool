import { Utils } from './utils.js';

// Simple Adapter for LocalStorage (UserScript)
// Can be extended for Chrome Storage later
export const Storage = {
    get: (key, defaultVal = null) => {
        const val = localStorage.getItem(key);
        return val ? val : defaultVal;
    },
    set: (key, value) => {
        localStorage.setItem(key, value);
    },
    remove: (key) => {
        localStorage.removeItem(key);
    },
    getJSON: (key, defaultVal = []) => {
        const val = localStorage.getItem(key);
        try {
            return val ? JSON.parse(val) : defaultVal;
        } catch (e) {
            return defaultVal;
        }
    },
    setJSON: (key, value) => {
        localStorage.setItem(key, JSON.stringify(value));
    },

    // Session Storage
    getSessionJSON: (key, defaultVal = []) => {
        const val = sessionStorage.getItem(key);
        try {
            return val ? JSON.parse(val) : defaultVal;
        } catch (e) {
            return defaultVal;
        }
    },
    setSessionJSON: (key, value) => {
        sessionStorage.setItem(key, JSON.stringify(value));
    }
};
