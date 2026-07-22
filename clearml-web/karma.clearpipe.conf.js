const baseConfig = require('./karma.conf.js');

module.exports = config => {
  baseConfig(config);
  config.set({
    autoWatch: false,
    browsers: ['ChromeHeadless'],
    singleRun: true,
  });
};
