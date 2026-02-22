// Simple Adapter for LocalStorage / SessionStorage with Memory Cache
export const Storage = {
    cache: {},
    sessionCache: {},

    get: (key, defaultVal = null) => {
        if (Storage.cache[key] !== undefined) return Storage.cache[key];
        const val = localStorage.getItem(key);
        Storage.cache[key] = val !== null ? val : defaultVal;
        return Storage.cache[key];
    },
    set: (key, value) => {
        Storage.cache[key] = value;
        localStorage.setItem(key, value);
    },
    remove: (key) => {
        delete Storage.cache[key];
        localStorage.removeItem(key);
    },
    getJSON: (key, defaultVal = []) => {
        if (Storage.cache[key] !== undefined && typeof Storage.cache[key] !== 'string') return Storage.cache[key];
        const val = localStorage.getItem(key);
        try {
            const parsed = val ? JSON.parse(val) : defaultVal;
            Storage.cache[key] = parsed;
            return parsed;
        } catch (e) {
            return defaultVal;
        }
    },
    setJSON: (key, value) => {
        Storage.cache[key] = value;
        localStorage.setItem(key, JSON.stringify(value));
    },

    // Session Storage
    getSessionJSON: (key, defaultVal = []) => {
        if (Storage.sessionCache[key] !== undefined) return Storage.sessionCache[key];
        const val = sessionStorage.getItem(key);
        try {
            const parsed = val ? JSON.parse(val) : defaultVal;
            Storage.sessionCache[key] = parsed;
            return parsed;
        } catch (e) {
            return defaultVal;
        }
    },
    setSessionJSON: (key, value) => {
        Storage.sessionCache[key] = value;
        sessionStorage.setItem(key, JSON.stringify(value));
    }
};
