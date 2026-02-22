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
    invalidate: (key) => {
        delete Storage.cache[key];
    },
    getJSON: (key, defaultVal = []) => {
        let parsed;
        if (Storage.cache[key] !== undefined && typeof Storage.cache[key] !== 'string') {
            parsed = Storage.cache[key];
        } else {
            const val = localStorage.getItem(key);
            try {
                parsed = val ? JSON.parse(val) : defaultVal;
                Storage.cache[key] = parsed;
            } catch (e) {
                parsed = defaultVal;
            }
        }
        // Return a clone to prevent accidental reference mutation bugs across contexts
        return Array.isArray(parsed) ? [...parsed] : (typeof parsed === 'object' && parsed !== null ? { ...parsed } : parsed);
    },
    setJSON: (key, value) => {
        Storage.cache[key] = value;
        localStorage.setItem(key, JSON.stringify(value));
    },

    // Session Storage
    getSessionJSON: (key, defaultVal = []) => {
        let parsed;
        if (Storage.sessionCache[key] !== undefined) {
            parsed = Storage.sessionCache[key];
        } else {
            const val = sessionStorage.getItem(key);
            try {
                parsed = val ? JSON.parse(val) : defaultVal;
                Storage.sessionCache[key] = parsed;
            } catch (e) {
                parsed = defaultVal;
            }
        }
        // Return a clone
        return Array.isArray(parsed) ? [...parsed] : (typeof parsed === 'object' && parsed !== null ? { ...parsed } : parsed);
    },
    setSessionJSON: (key, value) => {
        Storage.sessionCache[key] = value;
        sessionStorage.setItem(key, JSON.stringify(value));
    }
};
