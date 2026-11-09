// Category definitions shared by the menu and the settings window.
// Nothing here may import from the shell, because prefs.js loads it too.

// Display order. `match` lists freedesktop categories, checked in this order.
export const BUILTIN_GROUPS = [
    {id: 'favorites', title: 'Favorites', icon: 'starred-symbolic', match: []},
    {id: 'internet', title: 'Internet', icon: 'applications-internet-symbolic',
        match: ['WebBrowser', 'Network', 'Email', 'InstantMessaging', 'Chat', 'FileTransfer', 'P2P']},
    {id: 'development', title: 'Development', icon: 'applications-engineering-symbolic',
        match: ['Development', 'IDE', 'Debugger', 'TextEditor']},
    {id: 'office', title: 'Office', icon: 'applications-office-symbolic',
        match: ['Office', 'WordProcessor', 'Spreadsheet', 'Presentation', 'Calendar', 'ContactManagement']},
    {id: 'graphics', title: 'Graphics', icon: 'applications-graphics-symbolic',
        match: ['Graphics', '2DGraphics', 'RasterGraphics', 'VectorGraphics', 'Photography']},
    {id: 'media', title: 'Sound & Video', icon: 'applications-multimedia-symbolic',
        match: ['AudioVideo', 'Audio', 'Video', 'Player', 'Recorder', 'Music']},
    {id: 'games', title: 'Games', icon: 'applications-games-symbolic', match: ['Game']},
    {id: 'system', title: 'System', icon: 'applications-system-symbolic',
        match: ['Settings', 'System', 'Monitor', 'PackageManager', 'Security', 'HardwareSettings']},
    {id: 'utilities', title: 'Utilities', icon: 'applications-utilities-symbolic',
        match: ['Utility', 'Accessibility', 'Archiving', 'Calculator', 'FileManager', 'Core']},
    {id: 'other', title: 'Other', icon: 'view-more-symbolic', match: []},
];

export const CUSTOM_PREFIX = 'custom:';

// Built-in groups, then the ones the user added, always before "Other".
export function allGroups(customNames) {
    const custom = customNames.map(name => ({
        id: CUSTOM_PREFIX + name, title: name, icon: 'folder-symbolic', match: [], custom: true,
    }));
    const other = BUILTIN_GROUPS[BUILTIN_GROUPS.length - 1];
    return [...BUILTIN_GROUPS.slice(0, -1), ...custom, other];
}

// The group an app falls into by itself, from its desktop-file categories.
export function autoGroup(categoriesString) {
    const cats = (categoriesString ?? '').split(';').filter(Boolean);
    for (const g of BUILTIN_GROUPS) {
        if (g.match.length && g.match.some(m => cats.includes(m)))
            return g.id;
    }
    return 'other';
}

// Manual choices are stored as "app-id=group-id" strings.
export function parseOverrides(list) {
    const map = new Map();
    for (const entry of list) {
        const i = entry.lastIndexOf('=');
        if (i > 0) map.set(entry.slice(0, i), entry.slice(i + 1));
    }
    return map;
}

export function serializeOverrides(map) {
    return [...map].map(([app, group]) => `${app}=${group}`);
}
