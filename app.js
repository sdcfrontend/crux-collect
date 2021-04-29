const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fetch = require('node-fetch');
require('dotenv/config');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

const pipe = (...fns) => input => fns.reduce((chain, fn) => chain.then(fn), Promise.resolve(input));
const log = message => value => {
  console.log(message);
  return value;
}

const requestDeviceRecord = async requestBody => {
  try {
    const endpointUrl = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
    const requestOptions = {
      method: 'POST',
      body: JSON.stringify(requestBody)
    };

    const response = await fetch(`${endpointUrl}?key=${process.env.CRUX_API_KEY}`, requestOptions);
    const record = await response.json();

    return record;
  }

  catch(error) {
    setError(error);
  }
}

const getRecords = async page => {
  const requestBody = {
    origin: page.url
  }

  try {
    const mobileRecord = await requestDeviceRecord({ ...requestBody, formFactor: 'PHONE' });
    const desktopRecord = await requestDeviceRecord({ ...requestBody, formFactor: 'DESKTOP' });

    return Promise.all([mobileRecord, desktopRecord]).then(allRecords => {
      return { mobile: allRecords[0], desktop: allRecords[1] };
    });
  }

  catch(error) {
    setError(error);
  }
}

const storeRecords = page => async records => {
  console.log({pageId: page._id, devices: records})
  try {
    const requestBody = {
      pageId: page._id,
      devices: records
    }
    const requestOptions = {
      method: 'POST',
      body: JSON.stringify(requestBody),
      headers: {
        'Content-Type': 'application/json'
      }
    }
    const response = await fetch(`http://localhost:4000/records`, requestOptions);
    const pages = await response.json();

    return pages;
  }

  catch(error) {
    console.log(error)
  }
}

const getAndStoreRecords = page => pipe(
  log(`Getting records for ${page.url}`),
  getRecords,
  log(`Storing records for ${page.url}`),
  storeRecords(page)
)(page);

const getPages = async () => {
  try {
    const response = await fetch('http://localhost:4000/pages');
    const pages = await response.json();

    return pages;
  }

  catch(error) {
    console.log(error)
  }
}

const getAllRecords = async pages => await Promise.all(pages.map(page => getAndStoreRecords(page)));

const collectMetrics = pipe(
  log('Getting pages...'),
  getPages,
  log('Getting records for all pages...'),
  getAllRecords,
  log('All records stored.')
);

cron.schedule('0 0 0 * * *', () => {
  collectMetrics();
});

app.listen(5000);