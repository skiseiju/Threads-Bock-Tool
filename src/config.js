export const CONFIG = {
    VERSION: '2.0.7', // Performance Optimization Version
    DEBUG_MODE: true,
    DB_KEY: 'hege_block_db_v1',
    KEYS: {
        PENDING: 'hege_pending_users',
        BG_STATUS: 'hege_bg_status',
        BG_QUEUE: 'hege_active_queue',
        BG_CMD: 'hege_bg_command',
        IOS_MODE: 'hege_ios_active',
        MAC_MODE: 'hege_mac_mode',
        COOLDOWN: 'hege_rate_limit_until',
        VERSION_CHECK: 'hege_version_check',
        POS: 'hege_panel_pos',
        STATE: 'hege_panel_state',
        DISCLAIMER_AGREED: 'hege_disclaimer_agreed_v2_1',
        FAILED_QUEUE: 'hege_failed_queue'
    },
    SELECTORS: {
        MORE_SVG: 'svg[aria-label="更多"], svg[aria-label="More"]',
        MENU_ITEM: 'div[role="menuitem"], div[role="button"]',
        DIALOG: 'div[role="dialog"]',
    }
};
