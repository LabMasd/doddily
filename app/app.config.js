// app.json holds the config. The web version on GitHub Pages lives under /doddily, so only the web
// export (scripts/build-web.sh sets DODDILY_WEB=1) gets that base path. Native builds must not:
// it puts a "doddily" folder inside Doddily.app, which clashes with the app's own "Doddily" file.
module.exports = ({ config }) => {
  if (process.env.DODDILY_WEB !== '1') return config;
  // DODDILY_BASE overrides the path, for a preview copy hosted somewhere else (for example a hidden folder on doddily.app).
  return { ...config, experiments: { ...config.experiments, baseUrl: process.env.DODDILY_BASE || '/doddily' } };
};
