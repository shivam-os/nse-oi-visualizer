import express from 'express';
import axios from 'axios';
import UserAgent from 'user-agents';
import { formatData, getPayoffData } from './utils.js';

const baseURL = 'https://www.nseindia.com/';

const getOptionsWithUserAgent = () => {
  const userAgent = new UserAgent();
  return {
    headers: {
      "Accept": "*/*",
      "User-Agent": userAgent.toString(),
      "Connection": "keep-alive",
    },
    withCredentials: true,
  };
};

const app = express();
app.use(express.json());
app.use(express.urlencoded({extended: true}));

const MAX_RETRY_COUNT = 3;

const getOptionChainWithRetry = async (cookie, identifier, retryCount = 0) => {
  const isIndex = ["NIFTY", "BANKNIFTY", "FINNIFTY", "MIDCPNIFTY"].includes(identifier);
  const type = isIndex ? "Indices" : "Equities";

  const options = getOptionsWithUserAgent();

  try {
    const contractInfoUrl =
      `${baseURL}api/option-chain-contract-info?symbol=${encodeURIComponent(identifier)}`;

    const contractInfoRes = await axios.get(contractInfoUrl, {
      ...options,
      headers: { ...options.headers, Cookie: cookie }
    });

    const allExpiries = contractInfoRes.data?.expiryDates || [];
    const filteredExpiries = allExpiries.slice(0, 4);

    if (!filteredExpiries.length) {
      throw new Error("No expiry dates found");
    }

    const grouped = {};
    let strikePrices = new Set();
    let underlyingValue = null;

    for (const expiry of filteredExpiries) {
      const url =
        `${baseURL}api/option-chain-v3?type=${type}&symbol=${encodeURIComponent(identifier)}&expiry=${encodeURIComponent(expiry)}`;

      const response = await axios.get(url, {
        ...options,
        headers: { ...options.headers, Cookie: cookie }
      });

      const formatted = formatData(response.data, identifier);

      // merge grouped
      Object.assign(grouped, formatted.grouped);

      // collect strike prices
      formatted.strikePrices?.forEach(s => strikePrices.add(s));

      // underlying value (same for all expiries usually)
      if (!underlyingValue) {
        underlyingValue = formatted.underlyingValue;
      }
    }

    return {
      underlying: identifier,
      grouped,
      filteredExpiries,
      allExpiries,
      strikePrices: Array.from(strikePrices).sort((a, b) => a - b),
      underlyingValue
    };

  } catch (error) {
    console.error(`Error fetching option chain. Retry count: ${retryCount}`, error.message);

    if (retryCount < MAX_RETRY_COUNT) {
      return getOptionChainWithRetry(cookie, identifier, retryCount + 1);
    }

    throw new Error("Failed to fetch option chain after multiple retries");
  }
};



const getCookies = async () => {
  const options = getOptionsWithUserAgent();
  try {
    const response = await axios.get(baseURL + "option-chain", options);
    const cookie = response.headers['set-cookie'];
    return cookie;
  } catch (error) {
    console.error('Error fetching cookies:');
    throw new Error('Failed to fetch cookies');
  };
};

app.get('/open-interest', async (req, res) => {
  const now = new Date();
  const time = now.getHours() + ":" + now.getMinutes() + ":" + now.getSeconds();
  console.log(`Request received at ${time}`);

  const { identifier } = req.query;

  if (!identifier) {
    res.status(400).json({ error: 'Invalid request. No identifier was given.' });
    return;
  };

  try {
    const cookie = await getCookies();
    const data = await getOptionChainWithRetry(cookie, identifier.toUpperCase());
    res.json(data).status(200).end();
  } catch (error) {
    console.error('Proxy request error: here', error);
    res.status(500).json({ error: 'Proxy request failed.' });
  };
});

app.post('/builder', async (req, res) => {
  const builderData = req.body;
  try {
    const payoff = getPayoffData(builderData);
    res.json(payoff).status(200).end();
  } catch (error) {
    console.error('Payoff calculation error:', error);
    res.status(500).json({ error: 'Payoff calculation failed.' });
  };
  
});

app.listen(6123, () => {
  console.log('Server running on port 6123');
});
