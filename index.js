const express = require('express');
const cors = require('cors');
const cron = require('node-cron');
const fetch = require('node-fetch');
var cuid = require('cuid');
require('dotenv/config');

const app = express();

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({
  extended: true
}));

const requiredDevices = ['PHONE', 'DESKTOP'];
const metricsOrder = ['largest_contentful_paint', 'first_input_delay', 'cumulative_layout_shift', 'first_contentful_paint'];

const promisePipe = (...fns) => input => fns.reduce((chain, fn) => chain.then(fn), Promise.resolve(input));
const pipe = (...fns) => (...x) => fns.reduce((v, f) => f(v), ...x);
const log = message => value => {
  console.log(message);
  return value;
}

const metricsToArray = record => {
  return { ...record, metrics: Object.entries(record.metrics) }
};
const sortMetricsToOrder = order => record => ({ ...record, metrics: record.metrics.sort((a, b) => order.indexOf(Object.values(a)[0]) - order.indexOf(Object.values(b)[0])) });
const transform = record => record.metrics.map(metric => {
  return { [metric[0]]: { [record.key.formFactor]: { histogram: metric[1].histogram, percentiles: metric[1].percentiles } } }
});

const metricsToOrderedArray = (record, order) => pipe(
  metricsToArray,
  sortMetricsToOrder(order),
  transform
)(record)

const requestDeviceRecord = async requestBody => {
  try {
    const endpointUrl = 'https://chromeuxreport.googleapis.com/v1/records:queryRecord';
    const requestOptions = {
      method: 'POST',
      body: JSON.stringify(requestBody)
    };

    const response = await fetch(`${endpointUrl}?key=${process.env.CRUX_API_KEY}`, requestOptions);
    const data = await response.json();

    return metricsToOrderedArray(data.record, metricsOrder);
  }

  catch(error) {
    console.log(error);
  }
}

const getRecords = devices => async page => {
  const requestBody = {
    origin: page.url
  }

  try {
    return Promise.all(
      devices.map(async device => (
        await requestDeviceRecord({ ...requestBody, formFactor: device })
      )))
      .then(allDeviceRecords => {
        const mergedDevices = allDeviceRecords[0].map((metric, index) => {
          return { 
            _id: cuid(),
            name: Object.keys(metric)[0],
            ...{ 
              ...metric[Object.keys(metric)[0]],
              ...allDeviceRecords[1][index][Object.keys(allDeviceRecords[1][index])[0]]
            }
          }
        })
        return mergedDevices
      })
  }

  catch(error) {
    console.log(error);
  }
}

const storeRecords = page => async records => {
  try {
    const requestBody = {
      pageId: page._id,
      metrics: records
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

const getPageRecords = (page, devices) => promisePipe(
  log(`Getting records for ${page.url}`),
  getRecords(devices),
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

const getAllPageRecords = devices => async pages => await Promise.all(pages.map(page => getPageRecords(page, devices)));

const collectMetrics = devices => promisePipe(
  log('Getting pages...'),
  getPages,
  getAllPageRecords(devices),
  log('All records stored.')
)(devices);

cron.schedule('0 0 0 * * *', () => {
  collectMetrics(requiredDevices);
});

// collectMetrics(requiredDevices);

app.listen(5000);