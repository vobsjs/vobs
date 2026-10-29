import { registerIcon } from '@vobs/ui'

// App-level custom icons: lock/key are not in the VUI_ICON_PATHS built-in registry (used by the login page auth modes).
registerIcon({ 
    name: 'lock', 
    path: '<rect x="4" y="11" width="16" height="10"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>' 
})
registerIcon({ 
    name: 'key', 
    path: '<circle cx="7.5" cy="14.5" r="3.5"/><line x1="10" y1="12" x2="22" y2="12"/><line x1="22" y1="12" x2="22" y2="16"/><line x1="18" y1="12" x2="18" y2="15"/>' 
})
