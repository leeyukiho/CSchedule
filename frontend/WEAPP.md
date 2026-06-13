# WeChat Mini Program Build

This directory is the Taro mini program source.

## Build

```bash
cd frontend
pnpm build:weapp
```

The build output is:

```text
frontend/dist
```

## Open In WeChat DevTools

Preferred:

```text
frontend/dist
```

When opening `frontend/dist`, DevTools reads `frontend/dist/project.config.json`,
whose `miniprogramRoot` is `./`.

Alternative:

```text
frontend
```

When opening `frontend`, DevTools reads `frontend/project.config.json`, whose
`miniprogramRoot` is `dist/`.

Do not copy `frontend/project.config.json` into `frontend/dist` manually. If
`frontend/dist/project.config.json` contains `miniprogramRoot: "dist/"`,
DevTools will look for `frontend/dist/dist/app.json` and report that
`dist/app.json` cannot be found.
