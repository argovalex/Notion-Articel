const cron = require('node-cron');
const { scanAndSave } = require('./scanner');
const { publishApproved } = require('./publisher');

console.log('SafeHarbor Agent started');

cron.schedule('0 9 * * 0', async () => {
  console.log('Starting weekly scan...');
  await scanAndSave();
});

cron.schedule('0 * * * *', async () => {
  console.log('Checking for approved articles...');
  await publishApproved();
});

(async () => {
  if (process.env.RUN_ON_START === 'true') {
    await scanAndSave();
  }
  await publishApproved();
})();
