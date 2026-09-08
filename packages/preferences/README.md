# @vobs/preferences

Schema-validated, persisted user preferences exposed as typed reactive signals.

## Install

```bash
npm install @vobs/preferences
```

## Quick start

```ts
import { createPreferences, definePreferences } from '@vobs/preferences'

const schema = definePreferences({
  theme: { type: 'string', default: 'light', validate: value => value === 'light' || value === 'dark' },
  pageSize: { type: 'number', default: 20 }
})

const preferences = createPreferences({
  preferences: schema,
  storage: 'memory',
  saveDebounce: 100
})

preferences.set('theme', 'dark')
preferences.theme.value // 'dark' — every schema key is also a Signal
preferences.get('pageSize') // 20
preferences.reset('theme')
```

## API

| Signature | Description |
| --- | --- |
| `definePreferences(schema: S): S` | Validates a schema at creation; every entry needs a `default`, optional `type`, and optional `validate`. |
| `createPreferences(options: PreferencesOptions<S>): PreferencesContext<S>` | Creates a context; restores stored values immediately and starts auto-save unless `autoSave: false`. |
| `preferences.[key]: Signal` | Each schema key is exposed as a typed signal on the context. |
| `preferences.get(key)` / `preferences.set(key, value)` | Reads or writes one preference; `set` validates against the schema. |
| `preferences.reset(key)` / `preferences.resetAll()` | Restores defaults for one key or the whole schema. |
| `preferences.restore(): void` | Re-reads storage, validates entries, and reports invalid ones via `onError`. |
| `preferences.save(): void` | Persists all values with a `version` envelope; throws `PreferenceError('PERSIST_FAILED')` on failure. |
| `preferences.subscribe(listener): () => void` | Receives `{ key, value, source }` for `local`, `external`, and `restore` changes. |
| `preferences.dispose(): void` | Stops effects, timers, and the storage subscription. |
| `preferencesPlugin(options): VobsPlugin` | Provides the context through `PREFERENCES_KEY`. |
| `usePreferences<S>(): PreferencesContext<S>` | Injects the preferences context inside components. |

Values are checked against the schema `type` and optional `validate` predicate; `set` with an invalid value throws `PreferenceError('INVALID_VALUE')`, while invalid stored values fall back to defaults and are reported. Auto-save (on by default) persists schema values with optional `saveDebounce`; `version` plus `migrate` upgrades old payloads; `userSpecific` with `getUserId` re-restores when the user changes; external storage changes are picked up through the storage subscription.

## Types

`PreferenceSchema`, `PreferenceDefinition`, `PreferenceType`, `PreferenceValue`, `PreferenceSignals`, `PreferenceChange`, `PreferencesContext`, `PreferencesOptions`, `PreferencesPluginOptions`, `PreferenceErrorCode`
