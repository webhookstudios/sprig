import GObject from 'gi://GObject';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Shell from 'gi://Shell';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as AppFavorites from 'resource:///org/gnome/shell/ui/appFavorites.js';

import {allGroups, autoGroup, parseOverrides} from './groups.js';

function parseHex(hex, fallback) {
    const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex ?? '') ?? fallback;
    return [parseInt(m[1], 16), parseInt(m[2], 16), parseInt(m[3], 16)];
}

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;

// Colors for everything in the menu, derived from the settings.
function makePalette(s) {
    const text = parseHex(s.get_string('text-color'), ['','ff','ff','ff']);
    const bg = parseHex(s.get_string('background-color'), ['','24','24','28']);
    const accent = parseHex(s.get_string('accent-color'), ['','35','84','e4']);
    const luma = (0.299 * accent[0] + 0.587 * accent[1] + 0.114 * accent[2]) / 255;
    return {
        bg: rgba(bg, s.get_int('background-opacity') / 100),
        border: rgba(text, 0.14),
        text: rgba(text, 1),
        soft: rgba(text, 0.85),
        dim: rgba(text, 0.55),
        faint: rgba(text, 0.45),
        field: rgba(text, 0.08),
        fieldFocus: rgba(text, 0.12),
        hover: rgba(text, 0.09),
        press: rgba(text, 0.16),
        accent: rgba(accent, 1),
        onAccent: luma > 0.6 ? '#000000' : '#ffffff',
        star: '#f5c211',
    };
}

const AppMenuButton = GObject.registerClass(
class AppMenuButton extends PanelMenu.Button {
    _init(settings) {
        super._init(0.0, 'Sprig', false);
        this._settings = settings;

        const box = new St.BoxLayout({style_class: 'panel-status-menu-box'});
        box.add_child(new St.Icon({icon_name: 'view-app-grid-symbolic', style_class: 'system-status-icon'}));
        this._panelLabel = new St.Label({y_align: Clutter.ActorAlign.CENTER, style: 'padding-left: 4px;'});
        box.add_child(this._panelLabel);
        this.add_child(box);

        this._appSys = Shell.AppSystem.get_default();
        this._favs = AppFavorites.getAppFavorites();
        this._catButtons = new Map();
        this._sections = new Map();
        this._visible = [];

        this._buildMenu();
        this._applySettings();

        this._installedId = this._appSys.connect('installed-changed', () => { this._dirty = true; });
        this._favsId = this._favs.connect('changed', () => { if (this._apps) this._rebuildSoon(); });
        this._settingsId = this._settings.connect('changed', () => this._rebuildSoon());
        this._dirty = true;

        this.menu.connect('open-state-changed', (_m, open) => {
            if (!open) return;
            if (this._dirty) this._loadApps();
            this._entry.set_text('');
            this._renderList();
            this._scroll.vadjustment.value = 0;
            global.stage.set_key_focus(this._entry);
        });
    }

    _rebuildSoon() {
        if (this._rebuildId) return;
        this._rebuildId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 120, () => {
            this._rebuildId = 0;
            this._applySettings();
            if (this._apps) {
                this._loadApps();
                if (this._entry.get_text().trim()) this._onSearch();
                else this._renderList();
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    // Sizes and colors. Everything is styled inline so it follows the settings.
    _applySettings() {
        const s = this._settings;
        const P = this._p = makePalette(s);
        this._iconSize = s.get_int('icon-size');
        this._showSub = s.get_boolean('show-descriptions');

        this._panelLabel.text = s.get_string('panel-label');
        this._panelLabel.visible = s.get_boolean('show-panel-label') && this._panelLabel.text !== '';

        this.menu.box.set_style(
            `background-color: ${P.bg}; border: 1px solid ${P.border}; border-radius: ${s.get_int('corner-radius')}px;` +
            'box-shadow: 0 8px 32px rgba(0,0,0,0.55);');
        this._root.set_style(`width: ${s.get_int('menu-width')}px;`);
        this._body.set_style(`height: ${s.get_int('menu-height')}px;`);
        this._sidebar.set_style(`width: ${s.get_int('sidebar-width')}px;`);
        this._scroll.set_style(`border-left: 1px solid ${P.border};`);
        this._entryStyle(false);
        this._searchIcon.set_style(`color: ${P.dim};`);
    }

    _entryStyle(focused) {
        const P = this._p;
        this._entry.set_style(
            `background-color: ${focused ? P.fieldFocus : P.field}; color: ${P.text}; caret-color: ${P.text};` +
            `border: 1px solid ${focused ? P.accent : P.border}; border-radius: 12px;`);
    }

    // Re-colors a button from its current state.
    _restyle(btn) {
        const P = this._p;
        let extra = '';
        if (btn._active) extra = `background-color: ${P.accent}; color: ${P.onAccent};`;
        else if (btn.hover || btn.has_key_focus) extra = `background-color: ${P.hover};`;
        btn.set_style(`${btn._base ?? ''}${extra}`);
    }

    _track(btn, base) {
        btn._base = base;
        btn._active = false;
        btn.connect('notify::hover', () => this._restyle(btn));
        btn.connect('notify::key-focus', () => this._restyle(btn));
        this._restyle(btn);
    }

    _buildMenu() {
        this._root = new St.BoxLayout({vertical: true, style_class: 'agm-root'});

        this._entry = new St.Entry({
            style_class: 'agm-search', hint_text: 'Search apps…', can_focus: true, x_expand: true,
        });
        this._searchIcon = new St.Icon({icon_name: 'edit-find-symbolic', style_class: 'agm-search-icon'});
        this._entry.set_primary_icon(this._searchIcon);
        this._entry.clutter_text.connect('text-changed', () => this._onSearch());
        this._entry.clutter_text.connect('key-focus-in', () => this._entryStyle(true));
        this._entry.clutter_text.connect('key-focus-out', () => this._entryStyle(false));
        this._entry.clutter_text.connect('activate', () => {
            const first = this._visible[0];
            if (first) this._launch(first);
        });
        this._entry.clutter_text.connect('key-press-event', (_a, ev) => {
            if (ev.get_key_symbol() === Clutter.KEY_Escape && this._entry.get_text() !== '') {
                this._entry.set_text('');
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this._root.add_child(this._entry);

        this._body = new St.BoxLayout({style_class: 'agm-body'});
        this._sidebar = new St.BoxLayout({vertical: true, style_class: 'agm-sidebar'});
        this._body.add_child(this._sidebar);

        this._scroll = new St.ScrollView({
            style_class: 'agm-scroll', x_expand: true, y_expand: true,
            overlay_scrollbars: true, hscrollbar_policy: St.PolicyType.NEVER,
        });
        this._list = new St.BoxLayout({vertical: true, style_class: 'agm-list'});
        this._scroll.set_child(this._list);
        this._body.add_child(this._scroll);
        this._root.add_child(this._body);

        const item = new PopupMenu.PopupBaseMenuItem({reactive: false, can_focus: false});
        item.add_child(this._root);
        item.style_class = 'agm-item';
        this.menu.addMenuItem(item);
        this.menu.box.style_class = 'agm-menu-box';
    }

    _loadApps() {
        this._dirty = false;
        const s = this._settings;
        const hidden = new Set(s.get_strv('hidden-apps'));
        const overrides = parseOverrides(s.get_strv('app-groups'));
        this._groups = allGroups(s.get_strv('custom-groups'));
        const known = new Set(this._groups.map(g => g.id));
        const hiddenGroups = new Set(s.get_strv('hidden-groups'));
        this._groups = this._groups.filter(g => !hiddenGroups.has(g.id));

        this._apps = this._appSys.get_installed()
            .filter(i => i.should_show() && !hidden.has(i.get_id()))
            .map(i => {
                const id = i.get_id();
                let group = overrides.get(id);
                if (!group || !known.has(group)) group = autoGroup(i.get_categories());
                return {info: i, id, name: i.get_name() ?? '', group};
            })
            .sort((a, b) => a.name.localeCompare(b.name));

        this._sidebar.destroy_all_children();
        this._catButtons.clear();
        const P = this._p;
        for (const g of this._groups) {
            const btn = new St.Button({style_class: 'agm-cat', can_focus: true, x_expand: true, reactive: true});
            const row = new St.BoxLayout();
            row.add_child(new St.Icon({icon_name: g.icon, style_class: 'agm-cat-icon', style: `color: ${P.soft};`}));
            row.add_child(new St.Label({text: g.title, y_align: Clutter.ActorAlign.CENTER, x_expand: true,
                style: `color: ${P.soft};`}));
            const count = new St.Label({style_class: 'agm-count', y_align: Clutter.ActorAlign.CENTER,
                style: `color: ${P.faint};`});
            row.add_child(count);
            btn.set_child(row);
            btn.connect('clicked', () => this._jumpTo(g.id));
            this._track(btn, '');
            this._sidebar.add_child(btn);
            this._catButtons.set(g.id, {btn, count});
        }
        this._refreshCounts();
    }

    _appsIn(groupId) {
        if (groupId === 'favorites') {
            const ids = new Set(this._favs.getFavorites().map(a => a.get_id()));
            return this._apps.filter(x => ids.has(x.id));
        }
        return this._apps.filter(a => a.group === groupId);
    }

    _refreshCounts() {
        for (const g of this._groups) {
            const n = this._appsIn(g.id).length;
            const e = this._catButtons.get(g.id);
            e.count.text = n ? String(n) : '';
            e.btn.visible = n > 0 || g.id === 'favorites';
        }
    }

    _jumpTo(id) {
        if (this._entry.get_text()) {
            this._entry.set_text('');
            this._renderList();
        }
        for (const [gid, e] of this._catButtons) {
            e.btn._active = gid === id;
            this._restyle(e.btn);
        }
        const sec = this._sections.get(id);
        if (!sec) return;
        // Wait a moment so freshly built sections have an allocation.
        GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
            const adj = this._scroll.vadjustment;
            adj.ease(Math.min(sec.get_allocation_box().y1, Math.max(0, adj.upper - adj.page_size)), {
                duration: 200, mode: Clutter.AnimationMode.EASE_OUT_QUAD,
            });
            return GLib.SOURCE_REMOVE;
        });
    }

    _onSearch() {
        if (!this._apps) return;
        const q = this._entry.get_text().trim().toLowerCase();
        if (!q) {
            this._renderList();
            return;
        }
        for (const e of this._catButtons.values()) {
            e.btn._active = false;
            this._restyle(e.btn);
        }
        const score = a => {
            const n = a.name.toLowerCase();
            if (n.startsWith(q)) return 0;
            if (n.includes(q)) return 1;
            const hay = [a.info.get_generic_name?.(), a.info.get_description?.(),
                a.info.get_keywords?.()?.join(' '), a.id].filter(Boolean).join(' ').toLowerCase();
            return hay.includes(q) ? 2 : -1;
        };
        const hits = this._apps.map(a => [score(a), a]).filter(([sc]) => sc >= 0)
            .sort((x, y) => x[0] - y[0] || x[1].name.localeCompare(y[1].name)).map(([, a]) => a);
        this._renderList(hits, 'No matching apps');
    }

    _renderList(apps = null, emptyText = null) {
        if (!this._apps) return;
        if (apps === null && this._entry.get_text().trim()) return; // search owns the list
        this._refreshCounts();
        const P = this._p;
        this._list.destroy_all_children();
        this._sections = new Map();
        if (apps) {
            this._visible = apps;
            if (!apps.length) {
                this._list.add_child(new St.Label({style_class: 'agm-empty', text: emptyText ?? 'Nothing here.',
                    style: `color: ${P.dim};`}));
            }
            for (const a of apps) this._list.add_child(this._makeRow(a));
            return;
        }
        this._visible = [];
        for (const g of this._groups) {
            const items = this._appsIn(g.id);
            if (!items.length) continue;
            const sec = new St.BoxLayout({vertical: true, style_class: 'agm-section'});
            const head = new St.BoxLayout({style_class: 'agm-head'});
            head.add_child(new St.Icon({icon_name: g.icon, style_class: 'agm-head-icon', style: `color: ${P.accent};`}));
            head.add_child(new St.Label({text: g.title, style_class: 'agm-head-label',
                y_align: Clutter.ActorAlign.CENTER, style: `color: ${P.dim};`}));
            sec.add_child(head);
            for (const a of items) sec.add_child(this._makeRow(a));
            this._list.add_child(sec);
            this._sections.set(g.id, sec);
            this._visible.push(...items);
        }
        if (!this._visible.length) {
            this._list.add_child(new St.Label({style_class: 'agm-empty', style: `color: ${P.dim};`,
                text: 'No apps to show. Check which apps are hidden in Sprig settings.'}));
        }
    }

    _makeRow(a) {
        const P = this._p;
        const row = new St.BoxLayout({style_class: 'agm-row'});
        const btn = new St.Button({style_class: 'agm-app', can_focus: true, x_expand: true, reactive: true});
        const inner = new St.BoxLayout();
        inner.add_child(new St.Icon({gicon: a.info.get_icon(), icon_size: this._iconSize, style_class: 'agm-app-icon'}));
        const text = new St.BoxLayout({vertical: true, y_align: Clutter.ActorAlign.CENTER, x_expand: true});
        text.add_child(new St.Label({text: a.name, style_class: 'agm-app-name', style: `color: ${P.text};`}));
        const sub = this._showSub ? (a.info.get_generic_name?.() ?? a.info.get_description?.()) : null;
        if (sub) text.add_child(new St.Label({text: sub, style_class: 'agm-app-sub', style: `color: ${P.dim};`}));
        inner.add_child(text);
        btn.set_child(inner);
        btn.connect('clicked', () => this._launch(a));
        this._track(btn, '');

        const isFav = this._favs.isFavorite(a.id);
        const star = new St.Button({
            style_class: 'agm-star', can_focus: true, reactive: true,
            child: new St.Icon({icon_name: isFav ? 'starred-symbolic' : 'non-starred-symbolic', icon_size: 16}),
        });
        const starStyle = () => star.set_style(`color: ${isFav || star.hover ? P.star : P.faint};` +
            (star.hover ? `background-color: ${P.hover};` : ''));
        star.connect('notify::hover', starStyle);
        starStyle();
        star.connect('clicked', () => {
            if (this._favs.isFavorite(a.id)) this._favs.removeFavorite(a.id);
            else this._favs.addFavorite(a.id);
        });

        row.add_child(btn);
        row.add_child(star);
        return row;
    }

    _launch(a) {
        this.menu.close();
        const app = this._appSys.lookup_app(a.id);
        if (app) app.activate();
        else a.info.launch([], null);
    }

    destroy() {
        if (this._rebuildId) GLib.source_remove(this._rebuildId);
        this._rebuildId = 0;
        if (this._installedId) this._appSys.disconnect(this._installedId);
        if (this._favsId) this._favs.disconnect(this._favsId);
        if (this._settingsId) this._settings.disconnect(this._settingsId);
        this._installedId = this._favsId = this._settingsId = null;
        super.destroy();
    }
});

export default class SprigExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._button = new AppMenuButton(this._settings);
        Main.panel.addToStatusArea(this.uuid, this._button, 0, 'left');

        Main.wm.addKeybinding('toggle-menu', this._settings, Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW, () => this._button?.menu.toggle());
    }

    disable() {
        Main.wm.removeKeybinding('toggle-menu');
        this._button?.destroy();
        this._button = null;
        this._settings = null;
    }
}
