// netlify/functions/ntli-check.js
const axios = require('axios');

exports.handler = async () => {
  try {
    const siteID = process.env.NETLIFY_SITE_ID;
    const token  = process.env.NETLIFY_API_TOKEN;

    if (!siteID || !token) {
      return {
        statusCode: 500,
        body: JSON.stringify({ ok: false, message: 'Missing NETLIFY_SITE_ID or NETLIFY_API_TOKEN' })
      };
    }

    const res = await axios.get(`https://api.netlify.com/api/v1/sites/${siteID}`, {
      headers: { Authorization: `Bearer ${token}` }
    });

    return {
      statusCode: 200,
      body: JSON.stringify({ ok: true, site: { id: res.data.id, name: res.data.name, url: res.data.url } }, null, 2)
    };
  } catch (err) {
    return {
      statusCode: err.response?.status || 500,
      body: JSON.stringify({ ok: false, status: err.response?.status, data: err.response?.data, message: err.message }, null, 2)
    };
  }
};
