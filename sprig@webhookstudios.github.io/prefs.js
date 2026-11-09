import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {BUILTIN_GROUPS, allGroups, autoGroup, parseOverrides, serializeOverrides, CUSTOM_PREFIX}
    from './groups.js';

const COLORS = [
    ['background-color', 'Background'],
    ['text-color', 'Text and icons'],
    ['accent-color', 'Accent'],
];

const APPEARANCE_KEYS = [
    'menu-width', 'menu-height', 'sidebar-width', 'background-color', 'background-opacity',
    'text-color', 'accent-color', 'corner-radius', 'icon-size', 'show-descriptions',
    'panel-label', 'show-panel-label',
];

// Row titles are read as markup, so names with & or < must be escaped.
const esc = text => GLib.markup_escape_text(text, -1);

function switchRow(settings, key, title, subtitle) {
    const row = new Adw.SwitchRow({title, subtitle});
    settings.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function spinRow(settings, key, title, subtitle, step) {
    // The allowed range comes from the schema, so it is defined once.
    const [, [lower, upper]] = settings.settings_schema.get_key(key)
        .get_range().recursiveUnpack();
    const row = new Adw.SpinRow({
        title,
        subtitle,
        adjustment: new Gtk.Adjustment({lower, upper, step_increment: step, page_increment: step * 5}),
    });
    settings.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function entryRow(settings, key, title) {
    const row = new Adw.EntryRow({title});
    settings.bind(key, row, 'text', Gio.SettingsBindFlags.DEFAULT);
    return row;
}

function toHex(rgba) {
    const part = value => Math.round(value * 255).toString(16).padStart(2, '0');
    return `#${part(rgba.red)}${part(rgba.green)}${part(rgba.blue)}`;
}

function colorRow(settings, key, title) {
    const button = new Gtk.ColorDialogButton({
        dialog: new Gtk.ColorDialog({with_alpha: false}),
        valign: Gtk.Align.CENTER,
    });
    const show = () => {
        const rgba = new Gdk.RGBA();
        if (rgba.parse(settings.get_string(key)) && toHex(rgba) !== toHex(button.rgba))
            button.rgba = rgba;
    };
    show();
    settings.connect(`changed::${key}`, show);
    button.connect('notify::rgba', () => {
        const hex = toHex(button.rgba);
        if (hex !== settings.get_string(key))
            settings.set_string(key, hex);
    });
    const row = new Adw.ActionRow({title, activatable_widget: button});
    row.add_suffix(button);
    return row;
}

function shortcutText(settings, key) {
    const [accelerator] = settings.get_strv(key);
    if (!accelerator)
        return 'Disabled';
    const [ok, keyval, mods] = Gtk.accelerator_parse(accelerator);
    return ok ? Gtk.accelerator_get_label(keyval, mods) : accelerator;
}

// Opens a small dialog that waits for a key combination and stores it.
function captureShortcut(parent, settings, key, title) {
    const dialog = new Adw.Window({
        modal: true, transient_for: parent, title, default_width: 380, default_height: 180,
    });
    const view = new Adw.ToolbarView();
    view.add_top_bar(new Adw.HeaderBar());
    view.set_content(new Adw.StatusPage({
        title: 'Press the new shortcut',
        description: 'Esc cancels. Backspace disables the shortcut.\nShortcuts already used by the desktop cannot be chosen.',
    }));
    dialog.set_content(view);

    const controller = new Gtk.EventControllerKey();
    controller.connect('key-pressed', (_c, keyval, keycode, state) => {
        const mods = state & Gtk.accelerator_get_default_mod_mask();
        if (mods === 0 && keyval === Gdk.KEY_Escape) {
            dialog.close();
        } else if (mods === 0 && keyval === Gdk.KEY_BackSpace) {
            settings.set_strv(key, []);
            dialog.close();
        } else if (mods !== 0 && Gtk.accelerator_valid(keyval, mods)) {
            settings.set_strv(key, [Gtk.accelerator_name_with_keycode(
                null, Gdk.keyval_to_lower(keyval), keycode, mods)]);
            dialog.close();
        }
        return Gdk.EVENT_STOP;
    });
    dialog.add_controller(controller);
    dialog.present();
}

function shortcutRow(window, settings, key, title, subtitle) {
    const label = new Gtk.Label({
        label: shortcutText(settings, key), css_classes: ['dim-label'], valign: Gtk.Align.CENTER,
    });
    settings.connect(`changed::${key}`, () => (label.label = shortcutText(settings, key)));
    const row = new Adw.ActionRow({title, subtitle, activatable: true});
    row.add_suffix(label);
    row.add_suffix(new Gtk.Image({icon_name: 'go-next-symbolic'}));
    row.connect('activated', () => captureShortcut(window, settings, key, title));
    return row;
}

// ---- Pages ---------------------------------------------------------------

function appearancePage(window, settings) {
    const page = new Adw.PreferencesPage({title: 'Appearance', icon_name: 'preferences-desktop-appearance-symbolic'});

    const button = new Adw.PreferencesGroup({title: 'Top bar button'});
    button.add(entryRow(settings, 'panel-label', 'Button text'));
    button.add(switchRow(settings, 'show-panel-label', 'Show the text', 'Turn off to show only the icon'));
    button.add(shortcutRow(window, settings, 'toggle-menu', 'Open the menu', 'Shortcut that opens and closes Sprig'));
    page.add(button);

    const size = new Adw.PreferencesGroup({title: 'Size'});
    size.add(spinRow(settings, 'menu-width', 'Menu width', 'Pixels', 10));
    size.add(spinRow(settings, 'menu-height', 'Menu height', 'Pixels, of the app list', 10));
    size.add(spinRow(settings, 'sidebar-width', 'Category column width', 'Pixels', 2));
    size.add(spinRow(settings, 'icon-size', 'App icon size', 'Pixels', 2));
    page.add(size);

    const reset = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['flat']});
    reset.connect('clicked', () => APPEARANCE_KEYS.forEach(k => settings.reset(k)));
    const look = new Adw.PreferencesGroup({title: 'Look', header_suffix: reset});
    for (const [key, title] of COLORS)
        look.add(colorRow(settings, key, title));
    look.add(spinRow(settings, 'background-opacity', 'Background opacity', 'Percent', 5));
    look.add(spinRow(settings, 'corner-radius', 'Corner radius', 'Pixels', 1));
    look.add(switchRow(settings, 'show-descriptions', 'Show descriptions',
        'A short line under each app name'));
    page.add(look);
    return page;
}

function categoriesPage(settings) {
    const page = new Adw.PreferencesPage({title: 'Categories', icon_name: 'view-list-symbolic'});

    const builtin = new Adw.PreferencesGroup({
        title: 'Shown categories',
        description: 'Turn off a category to hide it, and the apps in it, from the menu.',
    });
    for (const g of BUILTIN_GROUPS) {
        const row = new Adw.SwitchRow({title: esc(g.title)});
        row.add_prefix(new Gtk.Image({icon_name: g.icon}));
        const sync = () => (row.active = !settings.get_strv('hidden-groups').includes(g.id));
        sync();
        row.connect('notify::active', () => {
            const hidden = settings.get_strv('hidden-groups').filter(id => id !== g.id);
            if (!row.active) hidden.push(g.id);
            if (hidden.join() !== settings.get_strv('hidden-groups').join())
                settings.set_strv('hidden-groups', hidden);
        });
        builtin.add(row);
    }
    page.add(builtin);

    const custom = new Adw.PreferencesGroup({
        title: 'Your categories',
        description: 'Add your own, then choose it for an app on the Apps page.',
    });
    const addRow = new Adw.EntryRow({title: 'New category name', show_apply_button: true});
    custom.add(addRow);
    let shown = [];
    const refresh = () => {
        shown.forEach(r => custom.remove(r));
        shown = [];
        for (const name of settings.get_strv('custom-groups')) {
            const row = new Adw.ActionRow({title: esc(name)});
            row.add_prefix(new Gtk.Image({icon_name: 'folder-symbolic'}));
            const del = new Gtk.Button({icon_name: 'user-trash-symbolic', valign: Gtk.Align.CENTER,
                css_classes: ['flat'], tooltip_text: 'Delete this category'});
            del.connect('clicked', () => {
                settings.set_strv('custom-groups', settings.get_strv('custom-groups').filter(n => n !== name));
                // Apps that were in it go back to automatic.
                const map = parseOverrides(settings.get_strv('app-groups'));
                for (const [app, grp] of [...map]) if (grp === CUSTOM_PREFIX + name) map.delete(app);
                settings.set_strv('app-groups', serializeOverrides(map));
            });
            row.add_suffix(del);
            custom.add(row);
            shown.push(row);
        }
    };
    addRow.connect('apply', () => {
        const name = addRow.text.trim();
        const list = settings.get_strv('custom-groups');
        const clash = [...BUILTIN_GROUPS.map(g => g.title), ...list].some(t => t.toLowerCase() === name.toLowerCase());
        if (name && !clash) settings.set_strv('custom-groups', [...list, name]);
        addRow.text = '';
    });
    settings.connect('changed::custom-groups', refresh);
    refresh();
    page.add(custom);

    const reset = new Adw.PreferencesGroup();
    const resetRow = new Adw.ActionRow({
        title: 'Reset category choices',
        subtitle: 'Puts every app back in its automatic category',
    });
    const btn = new Gtk.Button({label: 'Reset', valign: Gtk.Align.CENTER, css_classes: ['destructive-action']});
    btn.connect('clicked', () => settings.reset('app-groups'));
    resetRow.add_suffix(btn);
    reset.add(resetRow);
    page.add(reset);
    return page;
}

function appsPage(settings) {
    const page = new Adw.PreferencesPage({title: 'Apps', icon_name: 'view-app-grid-symbolic'});

    const search = new Gtk.SearchEntry({placeholder_text: 'Filter apps', hexpand: true});
    const top = new Adw.PreferencesGroup({
        title: 'Apps',
        description: 'Switch an app off to hide it from the menu, or pick a different category for it.',
    });
    top.add(search);
    page.add(top);

    const list = new Adw.PreferencesGroup();
    page.add(list);

    let rows = [];
    const fill = () => {
        rows.forEach(r => list.remove(r.row));
        rows = [];
        const groups = allGroups(settings.get_strv('custom-groups')).filter(g => g.id !== 'favorites');
        const titles = ['Automatic', ...groups.map(g => g.title)];
        const overrides = parseOverrides(settings.get_strv('app-groups'));
        const hidden = new Set(settings.get_strv('hidden-apps'));

        const apps = Gio.AppInfo.get_all().filter(a => a.should_show())
            .sort((a, b) => a.get_name().localeCompare(b.get_name()));
        for (const info of apps) {
            const id = info.get_id();
            const auto = BUILTIN_GROUPS.find(g => g.id === autoGroup(info.get_categories()));
            const row = new Adw.ActionRow({title: esc(info.get_name()), subtitle: esc(`Automatic: ${auto.title}`)});
            row.add_prefix(new Gtk.Image({gicon: info.get_icon(), pixel_size: 32}));

            const drop = new Gtk.DropDown({model: Gtk.StringList.new(titles), valign: Gtk.Align.CENTER});
            const idx = groups.findIndex(g => g.id === overrides.get(id));
            drop.selected = idx >= 0 ? idx + 1 : 0;
            drop.connect('notify::selected', () => {
                const map = parseOverrides(settings.get_strv('app-groups'));
                if (drop.selected === 0) map.delete(id);
                else map.set(id, groups[drop.selected - 1].id);
                settings.set_strv('app-groups', serializeOverrides(map));
            });

            const sw = new Gtk.Switch({active: !hidden.has(id), valign: Gtk.Align.CENTER,
                tooltip_text: 'Show in the menu'});
            sw.connect('notify::active', () => {
                const set = new Set(settings.get_strv('hidden-apps'));
                if (sw.active) set.delete(id);
                else set.add(id);
                settings.set_strv('hidden-apps', [...set]);
            });

            row.add_suffix(drop);
            row.add_suffix(sw);
            list.add(row);
            rows.push({row, name: info.get_name().toLowerCase()});
        }
        applyFilter();
    };
    const applyFilter = () => {
        const q = search.text.trim().toLowerCase();
        for (const r of rows) r.row.visible = !q || r.name.includes(q);
    };
    search.connect('search-changed', applyFilter);
    settings.connect('changed::custom-groups', fill);
    fill();
    return page;
}

export default class SprigPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();
        window.set_default_size(680, 760);
        window.add(appearancePage(window, settings));
        window.add(categoriesPage(settings));
        window.add(appsPage(settings));
    }
}
