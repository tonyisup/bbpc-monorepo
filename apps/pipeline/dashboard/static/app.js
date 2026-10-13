// BBPC pipeline dashboard. Read-only: this page only ever sends GET requests.
// Every figure is computed by the server (dashboard/views.py); this file lays it out.
'use strict';

const view = document.getElementById('view');

// Build an element. Text always goes in as text nodes, never as HTML.
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [name, value] of Object.entries(attrs || {})) {
    if (value === null || value === undefined || value === false) continue;
    if (name === 'class') el.className = value;
    else if (name === 'onclick') el.addEventListener('click', value);
    else el.setAttribute(name, value === true ? '' : value);
  }
  for (const child of children.flat(Infinity)) {
    if (child === null || child === undefined || child === false) continue;
    el.append(child instanceof Node ? child : String(child));
  }
  return el;
}

async function api(path) {
  const response = await fetch(path, {cache: 'no-store'});
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || `${path} answered ${response.status}`);
  return body;
}

const plural = (n, one, many) => `${n.toLocaleString()} ${n === 1 ? one : many || one + 's'}`;
const when = iso => (iso ? new Date(iso).toLocaleString([], {dateStyle: 'medium', timeStyle: 'short'}) : 'never');
const megabytes = bytes => `${Math.round(bytes / 1e6)} MB`;
const dot = tone => h('i', {class: `dot ${tone}`});
const pill = (tone, text) => h('span', {class: 'pill'}, dot(tone), text);
const tag = text => h('span', {class: 'tag'}, text);
const episodeName = ep => (ep.number ? `Ep ${ep.number}` : ep.date || ep.stem);
const episodeLink = (stem, text) => h('a', {href: `#episode/${stem}`}, text || stem);

// --------------------------------------------------------------------------- stages

const STAGE_LABELS = {import_transcript: 'import', review_clip: 'review clips'};
const STATE_WORDS = {
  done: 'file found', partial: 'some files found', missing: 'no file', waiting: 'waiting on Cowork',
  inferred: 'inferred from state.json, not checked', unknown: 'no way to tell from local files',
};
const STATE_MARKS = {done: '✓', partial: '◐', missing: '–', waiting: '…', inferred: '✓', unknown: '?'};
const stageLabel = stage => STAGE_LABELS[stage] || stage;
const stageTitle = row => `${stageLabel(row.stage)}: ${STATE_WORDS[row.state]}. ${row.detail}`;

function rail(stages) {
  return h('span', {class: 'rail'}, stages.map(row => h('i', {class: row.state, title: stageTitle(row)})));
}

function stageLegend() {
  const key = (state, text) => h('span', {}, h('span', {class: 'rail'}, h('i', {class: state})), text);
  return h('div', {class: 'legend mut sm'},
    key('done', 'file found'), key('partial', 'some files'), key('waiting', 'waiting on Cowork'),
    key('missing', 'no file'), key('inferred', 'inferred from state.json, not checked'),
    key('unknown', 'cannot tell'));
}

// --------------------------------------------------------------------------- Today

function coworkSummary(files) {
  const words = {ok: 'OK', invalid: 'has problems', missing: 'not written', not_written: 'not written (optional)'};
  return files.map(file => `${file.label}: ${words[file.status]}`).join(' · ');
}

function needRow(need) {
  if (need.kind === 'clips') {
    return h('div', {}, dot('wa'), h('div', {class: 't'},
      h('b', {}, `${episodeName(need)} · ${plural(need.count, 'rendered clip has', 'rendered clips have')} no publish decision`),
      h('div', {class: 'mut sm'}, need.title ? `${need.title} · ` : '', 'Record each one with ',
        h('code', {}, `python3 scripts/publish_decisions.py list ${need.stem}`))),
      h('a', {class: 'btn', href: `#episode/${need.stem}`}, 'Open episode'));
  }
  if (need.kind === 'cowork') {
    const ready = need.ready && need.ok;
    return h('div', {}, dot(ready ? 'in' : 'wa'), h('div', {class: 't'},
      h('b', {}, `${episodeName(need)} · ${ready ? "Cowork's files are ready" : 'waiting on Cowork'}`),
      h('div', {class: 'mut sm'}, coworkSummary(need.files)),
      ready && h('div', {class: 'mut sm'}, 'Resume with ',
        h('code', {}, `python pipeline.py episodes/${need.stem}.mp3 --from movies`)),
      !ready && need.headless && h('div', {class: 'mut sm'},
        'Headless Cowork is on, so its session failed or was skipped. Run the pipeline again to retry it, or write the files in Cowork.'),
      need.lastError && h('pre', {}, `Last error: ${need.lastError}`)),
      h('a', {class: 'btn', href: `#episode/${need.stem}`}, 'Open episode'));
  }
  if (need.kind === 'phrases') {
    return h('div', {}, dot('wa'), h('div', {class: 't'},
      h('b', {}, 'Phrase report is older than the ignore list'),
      h('div', {class: 'mut sm'}, `Report saved ${when(need.reportSavedAt)}, ignore.txt saved ${when(need.ignoreSavedAt)}. `,
        'Rescan (about 20 s) with ', h('code', {}, 'python3 scripts/scan_phrases.py'))));
  }
  return h('div', {}, dot('in'), h('div', {class: 't'},
    h('b', {}, `${plural(need.episodes.length, 'transcript has', 'transcripts have')} no SEO file or state entry`),
    h('div', {class: 'mono mut wrap'}, need.episodes.map(ep =>
      h('a', {href: `#episode/${ep.stem}`, title: `No ${ep.missing.join(', no ')}`}, ep.stem)))));
}

function shortsText(shorts) {
  if (!shorts) return '—';
  const parts = [];
  if (shorts.published) parts.push(`${shorts.published} published`);
  if (shorts.skipped) parts.push(`${shorts.skipped} skipped`);
  if (shorts.toReview) parts.push(`${shorts.toReview} to review`);
  return parts.join(', ') || '—';
}

function statusPill(row) {
  if (row.status === 'waiting') return pill('wa', 'Waiting on Cowork');
  if (row.status === 'review') return pill('wa', `${plural(row.shorts.toReview, 'clip')} to review`);
  if (row.status === 'done') return pill('ok', 'Done');
  return pill('no', 'Not processed');
}

function renderToday(data) {
  const a = data.archive;
  const tile = (label, value, note) => h('div', {class: 'tile'},
    h('div', {class: 'mut sm'}, label), h('div', {class: 'v'}, value.toLocaleString()), h('div', {class: 'mut sm'}, note));
  return [
    h('h3', {}, 'Needs you'),
    h('div', {class: 'need'}, data.needs.length ? data.needs.map(needRow)
      : h('div', {}, dot('ok'), h('div', {class: 't'}, 'Nothing needs you.'))),
    h('h3', {}, 'Archive'),
    h('div', {class: 'tiles'},
      tile('Transcripts', a.transcripts, a.firstDate ? `${a.firstDate} to ${a.lastDate}` : 'none yet'),
      tile('Episodes done', a.done, `${a.waiting} waiting on Cowork`),
      tile('Shorts published', a.shortsPublished, `of ${plural(a.decisions, 'decision')} recorded`),
      tile('Recurring phrases', a.phrases, a.phrasesScanned ? `plus ${plural(a.passages, 'passage')}` : 'not scanned yet')),
    h('h3', {}, 'Recent episodes'),
    h('table', {},
      h('tr', {}, ['Ep', 'Title', 'Stages', 'Status', 'Shorts'].map(name => h('th', {}, name))),
      data.recent.map(row => h('tr', {class: 'link', onclick: () => { location.hash = `#episode/${row.stem}`; }},
        h('td', {class: 'mono'}, row.number || '—'),
        h('td', {}, row.title && h('b', {}, row.title), row.title && ' ',
          h('span', {class: 'mut sm'}, row.date || row.stem)),
        h('td', {}, rail(row.stages)),
        h('td', {}, statusPill(row)),
        h('td', {class: 'mut sm'}, shortsText(row.shorts))))),
    data.recent.length ? h('div', {class: 'mut sm gap'}, `Stage bars: ${data.recent[0].stages.map(s => stageLabel(s.stage)).join(', ')}.`) : null,
    stageLegend(),
  ];
}

// --------------------------------------------------------------------------- Episode

function coworkFile(file, state) {
  const name = file.path.split('/').pop();
  const done = state.status === 'done';
  const shown = {
    ok: ['ok', `OK · ${file.summary}`],
    invalid: ['er', `FAIL · ${plural(file.problems.length, 'problem')}`],
    missing: [done ? 'no' : 'wa', done ? 'not written (the episode is done without it)' : 'MISSING'],
    not_written: ['no', 'not written (optional)'],
  }[file.status];
  return [
    h('div', {class: 'file'}, dot(shown[0]), h('span', {class: 'mono'}, name), h('span', {class: 'sp'}),
      h('span', {class: 'mut sm'}, shown[1])),
    file.problems.length ? h('ul', {class: 'sm problem'}, file.problems.map(text => h('li', {}, text))) : null,
    file.warnings.length ? h('ul', {class: 'sm warning'}, file.warnings.map(text => h('li', {}, `warning: ${text}`))) : null,
  ];
}

function seoBox(ep) {
  const seo = ep.seo;
  if (!seo) return h('div', {class: 'box mut'}, 'No SEO file yet.');
  const over = seo.titleLength > seo.titleMax;
  const fill = h('i', {});
  fill.style.width = `${Math.min(100, Math.round(100 * seo.titleLength / seo.titleMax))}%`;
  return h('div', {class: 'box bar'},
    h('div', {class: 't sp'},
      seo.title ? h('b', {}, seo.title) : h('span', {class: 'problem'}, 'No title in this file'),
      h('div', {class: over ? 'sm warning' : 'sm mut'},
        `${seo.titleLength} of ${seo.titleMax} characters${over ? `: ${seo.titleLength - seo.titleMax} over` : ''}`),
      h('div', {class: over ? 'meter over' : 'meter'}, fill),
      h('div', {class: 'mut sm mono gap'}, seo.source)),
    ep.thumbnail && h('img', {class: 'thumb', src: ep.thumbnail, alt: 'Episode thumbnail', loading: 'lazy'}));
}

function moviesBox(movies) {
  if (!movies.source) return h('div', {class: 'box mut'}, 'No movies file yet.');
  const rated = movies.rows.some(row => movies.hosts.some(host => row.ratings[host]));
  const withId = movies.rows.filter(row => row.hasMovieId).length;
  const about = row => [
    row.reviewType && row.reviewType.replace('_', ' '),
    row.pickedBy && `${row.pickedBy}'s pick`,
    row.status !== 'accepted' && row.status,
  ].filter(Boolean).join(' · ');
  return h('div', {class: 'box'},
    movies.rows.length ? h('table', {},
      h('tr', {}, h('th', {}, 'Movie'), movies.hosts.map(host => h('th', {}, host))),
      movies.rows.map(row => h('tr', {},
        h('td', {}, h('b', {}, row.title || 'untitled'), row.year ? ` (${row.year})` : '',
          about(row) && h('div', {class: 'mut sm'}, about(row))),
        movies.hosts.map(host => h('td', {}, row.ratings[host] || ''))))) : h('div', {class: 'mut'}, 'No movies in this file.'),
    h('div', {class: 'mut sm gap'},
      movies.rows.length && !rated ? 'This file has no host ratings. ' : '',
      movies.rows.length ? `${withId} of ${movies.rows.length} have a Convex movie ID in the file. ` : ''),
    h('div', {class: 'mut sm mono'}, [movies.source, movies.extractor].filter(Boolean).join(' · ')));
}

function renderEpisode(ep, list) {
  const picker = h('select', {class: 'btn', 'aria-label': 'Episode'}, list.map(row =>
    h('option', {value: row.stem, selected: row.stem === ep.stem},
      [row.number, row.title, row.date || row.stem].filter(Boolean).join(' · '))));
  picker.addEventListener('change', () => { location.hash = `#episode/${picker.value}`; });
  const step = (stem, text) => h('a', {class: stem ? 'btn' : 'btn off', href: stem ? `#episode/${stem}` : null}, text);
  const state = ep.state;
  const named = [ep.number, ep.title].filter(Boolean).join(' · ');
  return [
    h('div', {class: 'bar'},
      h('b', {class: 'big'}, named || ep.date || ep.stem),
      h('span', {class: 'mut'}, [named && ep.date, ep.audio ? `${ep.audio.file} · ${megabytes(ep.audio.bytes)}` : 'no local mp3'].filter(Boolean).join(' · ')),
      h('span', {class: 'sp'}), step(ep.prev, '← Older'), picker, step(ep.next, 'Newer →')),
    ep.audio
      ? h('audio', {controls: true, preload: 'none', src: ep.audio.url})
      : h('div', {class: 'mut sm gap'}, `No local mp3 for this episode, so there is nothing to play. ${plural(ep.audioEpisodes, 'episode has', 'episodes have')} one.`),
    h('h3', {}, 'Stages'),
    h('div', {class: 'stages'}, ep.stages.map(row => h('div', {class: `stage ${row.state}`, title: stageTitle(row)},
      h('b', {}, STATE_MARKS[row.state]), stageLabel(row.stage),
      h('span', {class: 'd'}, row.checked ? row.detail : `${row.state}: no local file`)))),
    h('div', {class: 'mut sm gap'},
      'Solid boxes were checked against a file. Dashed and dotted boxes (import, publish) leave no local file, so they are read from state.json: ',
      state.status ? h('b', {}, state.status) : h('b', {}, 'no entry'),
      state.updatedAt ? `, updated ${when(state.updatedAt)}` : '', state.note ? ` (${state.note})` : '', '.'),
    state.lastError && h('pre', {}, `Last error: ${state.lastError}`),
    h('div', {class: 'two'},
      h('div', {},
        h('h3', {}, 'Cowork files'),
        h('div', {class: 'box'}, ep.cowork.files.map(file => coworkFile(file, state)),
          !ep.cowork.transcriptFound && h('div', {class: 'mut sm gap'},
            'Transcript not found, so the duration, segment-boundary and phrase-text checks were skipped.')),
        h('h3', {}, 'SEO title'),
        seoBox(ep)),
      h('div', {}, h('h3', {}, 'Movies'), moviesBox(ep.movies))),
  ];
}

// --------------------------------------------------------------------------- Settings

function shown(value) {
  if (value === null || value === undefined) return 'unset';
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function settingRow(row) {
  const from = row.source === 'config' ? 'config.json' : row.source === 'default' ? 'code default' : `from ${row.source}`;
  const changed = row.source !== 'default' && shown(row.value) !== shown(row.default);
  const long = row.type === 'text';
  return h('tr', {},
    h('td', {class: 'k'}, h('b', {class: 'mono'}, row.key), h('div', {class: 'mut sm'}, row.description),
      (row.choices.length || row.minimum !== null) && h('div', {class: 'mut sm'},
        row.choices.length ? `One of: ${row.choices.join(', ')}` : `${row.minimum} to ${row.maximum}`)),
    h('td', {}, h('span', {class: `val${changed ? ' ch' : ''}${long ? ' text' : ''}`}, shown(row.value)),
      row.problems.map(text => h('div', {class: 'sm problem'}, text))),
    h('td', {class: 'mut wrap'}, long && shown(row.value) === shown(row.default) ? 'same' : shown(row.default)),
    h('td', {class: 'right'}, tag(from),
      h('div', {class: 'mut sm'}, row.stages.length ? row.stages.map(stageLabel).join(', ') : 'nothing reads it')));
}

function configCheck(check) {
  const keys = list => h('div', {class: 'mono mut wrap'}, list.join(' · '));
  const lines = [];
  if (check.notInConfig.length) {
    lines.push(h('li', {}, h('details', {},
      h('summary', {}, `${plural(check.notInConfig.length, 'setting')} the code reads ${check.notInConfig.length === 1 ? 'is' : 'are'} not in config.json`),
      keys(check.notInConfig))));
  }
  for (const key of check.unread) lines.push(h('li', {}, h('span', {class: 'mono'}, key), ' is set but nothing reads it'));
  for (const key of check.undeclared) lines.push(h('li', {class: 'warning'}, h('span', {class: 'mono'}, key), ' is set but is not a known setting'));
  for (const row of check.invalid) lines.push(h('li', {class: 'problem'}, row.problems.join('; ')));
  return h('div', {class: 'box gap'}, h('b', {}, 'Config check'),
    lines.length ? h('ul', {}, lines) : h('div', {class: 'mut sm'}, 'config.json matches what the code reads.'));
}

function clipLook(look) {
  return [
    h('div', {class: 'bar gap'}, h('b', {}, 'The look of a rendered clip'), h('span', {class: 'sp'}), tag('in code, read-only')),
    h('div', {class: 'mut sm'}, 'These are constants in lib/clipper.py, not settings. They become settings with the Lab.'),
    h('table', {class: 'cols'},
      look.constants.map(row => h('tr', {},
        h('td', {class: 'k'}, h('b', {class: 'mono'}, row.name), h('div', {class: 'mut sm'}, row.description)),
        h('td', {colspan: 3}, h('span', {class: 'val'}, shown(row.value))))),
      h('tr', {}, h('td', {class: 'k'}, h('b', {}, 'Zoom')), h('td', {colspan: 3}, look.zoom)),
      h('tr', {}, h('td', {class: 'k'}, h('b', {}, 'Caption style'),
        h('div', {class: 'mut sm'}, 'The ASS style line: font, size, colours, outline, margins.')),
        h('td', {class: 'mono wrap', colspan: 3}, look.captionStyle))),
  ];
}

function renderSettings(data) {
  const anchor = name => `group-${name.toLowerCase().replace(/[^a-z]+/g, '-')}`;
  const jump = name => () => document.getElementById(anchor(name)).scrollIntoView({behavior: 'smooth'});
  const extras = {
    'Clips and captions': () => clipLook(data.look),
    Prompts: () => [
      h('div', {class: 'box gap'},
        h('div', {class: 'bar'}, h('b', {}, 'Abstract-visual guardrail'), h('span', {class: 'sp'}), tag('in code, always appended')),
        h('div', {class: 'sm gap'}, data.guardrail),
        h('div', {class: 'bar gap'}, h('b', {}, 'Image prompt per clip'), h('span', {class: 'sp'}), tag('written by Cowork')),
        h('div', {class: 'mut sm'}, "Each clip's imagePrompt is in the episode's SEO file. The image model receives the prompt, then the style suffix, then the guardrail.")),
    ],
    'Cowork instructions': () => [
      h('div', {class: 'box gap'},
        h('div', {class: 'bar'}, h('b', {}, 'What Cowork reads'), h('span', {class: 'sp'}), tag('files in git')),
        h('div', {class: 'mono gap'}, data.docs.map((doc, i) => [i ? ' · ' : '',
          h('a', {href: doc.url, target: '_blank', rel: 'noopener'}, doc.name)])),
        h('div', {class: 'mut sm'}, 'They change what Cowork writes for the next episode. Edit them in the repository.')),
    ],
  };
  return [
    h('div', {class: 'mut sm'}, 'Read-only. Values come from config.json; a setting it leaves out uses the default in lib/settings_schema.py.'),
    h('div', {class: 'set gap'},
      h('div', {class: 'nav sm'},
        data.groups.map(group => h('a', {href: '#settings', onclick: event => { event.preventDefault(); jump(group.name)(); }}, group.name)),
        configCheck(data.check)),
      h('div', {}, data.groups.map(group => [
        h('h3', {id: anchor(group.name)}, group.name),
        group.settings.length ? h('table', {class: 'cols'},
          h('tr', {}, ['Setting', 'Value', 'Default', ''].map(name => h('th', {}, name))),
          group.settings.map(settingRow)) : null,
        extras[group.name] ? extras[group.name]() : null,
      ]))),
  ];
}

// --------------------------------------------------------------------------- routing

function show(nodes) {
  view.replaceChildren(...[nodes].flat(Infinity).filter(Boolean));
}

function setNeedsCount(count) {
  const badge = document.getElementById('needs-count');
  badge.textContent = count;
  badge.hidden = !count;
}

let latestRoute = 0;

async function route() {
  const [tab, argument] = (location.hash.slice(1) || 'today').split('/');
  const known = ['today', 'episode', 'settings'].includes(tab) ? tab : 'today';
  for (const link of document.querySelectorAll('#tabs a')) link.classList.toggle('on', link.dataset.tab === known);
  // A slow answer for a tab the reader has already left must not replace the current one.
  const ticket = ++latestRoute;
  const current = nodes => { if (ticket === latestRoute) show(nodes); };
  try {
    if (known === 'today') {
      const data = await api('/api/today');
      setNeedsCount(data.needs.length);
      current(renderToday(data));
    } else if (known === 'settings') {
      current(renderSettings(await api('/api/settings')));
    } else {
      const list = await api('/api/episodes');
      const stem = argument || (list[0] && list[0].stem);
      if (!stem) {
        current(h('p', {class: 'mut'}, 'No episodes yet.'));
        return;
      }
      const ep = await api(`/api/episode?stem=${encodeURIComponent(stem)}`);
      document.getElementById('episode-tab').textContent = ep.number ? `Episode ${ep.number}` : 'Episode';
      current(renderEpisode(ep, list));
    }
  } catch (error) {
    current(h('div', {class: 'box problem'}, `Could not load this tab: ${error.message}`));
  }
}

async function start() {
  window.addEventListener('hashchange', route);
  route();
  try {
    const header = await api('/api/header');
    document.getElementById('data-dir').textContent = header.dataDir;
    document.getElementById('convex').textContent = header.convex;
    if ((location.hash.slice(1) || 'today').split('/')[0] !== 'today') {
      setNeedsCount((await api('/api/today')).needs.length);
    }
  } catch (error) {
    document.getElementById('data-dir').textContent = `server not answering: ${error.message}`;
  }
}

start();
