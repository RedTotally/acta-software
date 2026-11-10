# Acta

Acta is a group board for people who already know each other. One person creates a group and shares a join link. Members log what they actually did. Standing moves only when a score step changes it.

Accounts, groups, and standing stay in a local SQLite file (`data/acta.sqlite`, not committed). Acta needs its own database later, not the GoDotWebs one.

## Web

```bash
npm install
npm run dev
```

Open http://127.0.0.1:4730

Use a private window for the second account. The join page works in the browser. It does not ask for a desktop install.

## Desktop

```bash
npm run desktop
```

Desktop uses the same accounts as the web app. Sign in with the same email and password. Home is that group’s board.

If the web server is already running, desktop connects to it. Otherwise it starts one.

## Join links

Copied links use the current page origin. Set `ACTA_PUBLIC_ORIGIN` only when a copied link should use a different origin where this Acta app is served, for example `http://192.168.1.20:4730`. Leave it unset to keep the page origin. See `.env.example`. Do not commit `.env`.

`?next=` after sign-in returns only to a `/join/<token>` or `/groups/<groupId>` path.

## Score step

Standing changes only after a score step. Acta does not keep a word list to decide that.

`npm run score-engine` downloads a local llama.cpp server and a small instruct model into `data/score/` (not committed). The next `npm run dev` starts that score step with the app.

Or set `ACTA_SCORE_BASE_URL` to an OpenAI-compatible server. `ACTA_SCORE_API_KEY` and `ACTA_SCORE_MODEL` are optional.

If the score step is missing or its reply cannot be read, the log does not move the board and Acta says “The score could not be worked out.” An empty log closes quietly. When the score step is running, a log it judges as not real work (such as “updated my CV”) also closes quietly. A second log the same day moves standing only when the score changes again.

## Tests

```bash
npm test
```
