# `@novastarter/rate-limiter`

Pressure based rate limiter

## Usage

### Standalone

The pressure monitor is a class that can be used anywhere:

```js
import { RateLimiter } from '@novastarter/rate-limiter';

const monitor = new RateLimiter({
	maxEventLoopUtilization: 0.8,
});

monitor.overloaded; // true | false
```

### Express

The library also exports an express middleware that can be used to throw an Error when the pressure monitor reports
overloaded:

```js
import express from 'express';
import { handleRateLimit } from '@novastarter/rate-limiter';

const app = express();

app.use(
	handleRateLimit({
		maxEventLoopUtilization: 0.8,
	}),
);
```
