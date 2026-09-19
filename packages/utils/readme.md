# `@novastarter/utils`

Utilities shared between the Nova packages

## `formatTitle`

Custom formatter that converts any string into
[Title Case](https://apastyle.apa.org/style-grammar-guidelines/capitalization/title-case).

Capital letters are used for principal words. Articles, conjunctions, and prepositions do not get capital letters unless
they start or end the title.

| Input                        | Output                          |
| ---------------------------- | ------------------------------- |
| `snowWhiteAndTheSevenDwarfs` | Snow White and the Seven Dwarfs |
| `NewcastleUponTyne`          | Newcastle Upon Tyne             |
| `brighton_on_sea`            | Brighton on Sea                 |
| `apple_releases_new_ipad`    | Apple Releases New iPad         |
| `7-food-trends`              | 7 Food Trends                   |

> The helper contains a list of words that use some sort of special casing, for example: McDonalds, iPhone, and YouTube.

By default it converts camelCase, PascalCase, underscore, and "regular" sentences to Title Case.

```ts
import { formatTitle } from '@novastarter/utils';

formatTitle(string, [separator]);

formatTitle('snowWhiteAndTheSevenDwarfs');
// => Snow White and the Seven Dwarfs
```

You can provide an optional `separator` regex as a second parameter to support splitting the string on different
characters. By default, this regex is set to `/\s|-|_/g`.

Ported from [`@directus/format-title`](https://github.com/directus/directus/tree/main/packages/format-title) (MIT,
Copyright Monospace, Inc.).
