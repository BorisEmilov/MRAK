/**
 * Forms generated from the content JSON Schemas (packages/content-schema/json-schema). Unions of
 * operator objects (conditions, effects, modifiers) become a visual editor: pick the operator,
 * then edit its fields; `all`/`any`/`not`/`if` nest naturally. Fields documented as "Reference to
 * a <kind>" autocomplete from the ids of that kind (flags, stats, villagers, items, loc keys…).
 */
import { useId, useState, type ReactNode } from 'react';
import type { JsonSchema } from './api';
import { branches, makeDefault, opOf, refKind, resolve, type FormCtx } from './schema';

type S = JsonSchema;

const obj = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export function Field({
  schema,
  value,
  onChange,
  ctx,
  label,
}: {
  schema: S;
  value: unknown;
  onChange: (v: unknown) => void;
  ctx: FormCtx;
  label?: string;
}): ReactNode {
  const { schema: s, name } = resolve(schema, ctx);
  const listId = useId();
  const anyOf = branches(s);
  if (anyOf.length > 0) {
    const ops = anyOf.map((b) => opOf(b, ctx));
    if (ops.every((o) => o !== null))
      return (
        <Union
          label={label ?? name}
          options={anyOf}
          ops={ops}
          value={value}
          onChange={onChange}
          ctx={ctx}
        />
      );
    return <JsonField label={label} value={value} onChange={onChange} />;
  }
  if (Array.isArray(s['enum']))
    return (
      <label className="field">
        <span>{label}</span>
        <select
          value={String(value)}
          onChange={(e) => {
            const opt = (s['enum'] as unknown[]).find((x) => String(x) === e.target.value);
            onChange(opt);
          }}
        >
          {(s['enum'] as unknown[]).map((x) => (
            <option key={String(x)}>{String(x)}</option>
          ))}
        </select>
      </label>
    );
  switch (s['type']) {
    case 'object': {
      const props = (s['properties'] ?? {}) as Record<string, S>;
      if (Object.keys(props).length === 0)
        return <JsonField label={label} value={value} onChange={onChange} />;
      const v = obj(value) ? value : {};
      const req = new Set((s['required'] ?? []) as string[]);
      return (
        <fieldset className="object">
          {label && <legend>{label}</legend>}
          {Object.entries(props).map(([k, ps]) =>
            k in v ? (
              <div key={k} className="prop">
                <Field
                  schema={ps}
                  value={v[k]}
                  label={req.has(k) ? `${k} *` : k}
                  ctx={ctx}
                  onChange={(nv) => {
                    onChange({ ...v, [k]: nv });
                  }}
                />
                {!req.has(k) && (
                  <button
                    type="button"
                    className="link"
                    onClick={() => {
                      const { [k]: _drop, ...rest } = v;
                      onChange(rest);
                    }}
                  >
                    remove {k}
                  </button>
                )}
              </div>
            ) : (
              <button
                key={k}
                type="button"
                className="link add"
                onClick={() => {
                  onChange({ ...v, [k]: makeDefault(ps, ctx) });
                }}
              >
                + {k}
              </button>
            ),
          )}
        </fieldset>
      );
    }
    case 'array': {
      const items = (s['items'] ?? {}) as S;
      const list: unknown[] = Array.isArray(value) ? (value as unknown[]) : [];
      return (
        <fieldset className="array">
          {label && <legend>{label}</legend>}
          {list.map((item, i) => (
            <div key={i} className="item">
              <Field
                schema={items}
                value={item}
                ctx={ctx}
                onChange={(nv) => {
                  onChange(list.map((x, j) => (j === i ? nv : x)));
                }}
              />
              <button
                type="button"
                className="link"
                onClick={() => {
                  onChange(list.filter((_x, j) => j !== i));
                }}
              >
                remove
              </button>
            </div>
          ))}
          <button
            type="button"
            className="link add"
            onClick={() => {
              onChange([...list, makeDefault(items, ctx)]);
            }}
          >
            + add
          </button>
        </fieldset>
      );
    }
    case 'integer':
    case 'number':
      return (
        <label className="field">
          <span>{label}</span>
          <input
            type="number"
            value={typeof value === 'number' ? value : ''}
            step={s['type'] === 'integer' ? 1 : 'any'}
            onChange={(e) => {
              onChange(e.target.value === '' ? undefined : Number(e.target.value));
            }}
          />
        </label>
      );
    case 'boolean':
      return (
        <label className="field check">
          <input
            type="checkbox"
            checked={value === true}
            onChange={(e) => {
              onChange(e.target.checked);
            }}
          />
          <span>{label}</span>
        </label>
      );
    case 'string': {
      const kind = refKind(s);
      const options = kind ? (ctx.ids[kind] ?? []) : [];
      const text = typeof value === 'string' ? value : '';
      const missing = kind !== null && text !== '' && !options.includes(text);
      return (
        <label className="field">
          <span>
            {label}
            {kind && <em className="kind"> {kind}</em>}
          </span>
          <input
            value={text}
            list={kind ? listId : undefined}
            className={missing ? 'unknown' : undefined}
            onChange={(e) => {
              onChange(e.target.value);
            }}
          />
          {kind && (
            <datalist id={listId}>
              {options.slice(0, 2000).map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          )}
          {kind === 'loc' && ctx.texts[text] && <small className="loc">“{ctx.texts[text]}”</small>}
          {missing && <small className="bad">unknown {kind}</small>}
        </label>
      );
    }
    default:
      return <JsonField label={label} value={value} onChange={onChange} />;
  }
}

/** Operator union: choose the operator, then its own fields (nested conditions/effects recurse). */
function Union({
  label,
  options,
  ops,
  value,
  onChange,
  ctx,
}: {
  label: string | null | undefined;
  options: S[];
  ops: (string | null)[];
  value: unknown;
  onChange: (v: unknown) => void;
  ctx: FormCtx;
}) {
  const current = obj(value) ? ops.findIndex((o) => o !== null && o in value) : -1;
  const branch = options[current];
  return (
    <div className={`union ${label === 'Condition' ? 'cond' : label === 'Effect' ? 'eff' : ''}`}>
      <select
        value={current}
        aria-label={label ?? 'operator'}
        onChange={(e) => {
          const b = options[Number(e.target.value)];
          if (b) onChange(makeDefault(b, ctx));
        }}
      >
        {current < 0 && <option value={-1}>— choose —</option>}
        {ops.map((o, i) => (
          <option key={`${String(o)}${String(i)}`} value={i}>
            {o}
          </option>
        ))}
      </select>
      {branch && <Field schema={branch} value={value} onChange={onChange} ctx={ctx} />}
    </div>
  );
}

function JsonField({
  label,
  value,
  onChange,
}: {
  label?: string | undefined;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  const [text, setText] = useState(() => JSON.stringify(value ?? null, null, 2));
  const [bad, setBad] = useState(false);
  return (
    <label className="field">
      <span>{label} (JSON)</span>
      <textarea
        rows={Math.min(12, text.split('\n').length + 1)}
        value={text}
        className={bad ? 'unknown' : undefined}
        onChange={(e) => {
          setText(e.target.value);
          try {
            onChange(JSON.parse(e.target.value));
            setBad(false);
          } catch {
            setBad(true);
          }
        }}
      />
    </label>
  );
}
