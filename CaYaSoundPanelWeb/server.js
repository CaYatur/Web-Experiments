const express = require('express');
const path = require('path');
const cookieParser = require('cookie-parser');

const app = express();
app.use(cookieParser());

const PORT = process.env.PORT || 3000;

app.use((req, res, next) => {
  // set a cookie that the client requires to enable functionality
  if (!req.cookies || !req.cookies._caya_session) {
    res.cookie('_caya_session', '1', { httpOnly: false, sameSite: 'Lax' });
  }
  next();
});

// serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/health', (req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Server listening on http://localhost:${PORT}`));
