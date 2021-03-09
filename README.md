# Heapquery

Query the objects on the heap of node.js

## Usage

```bash
npx heapquery path_to_your_heapdump.heapsnapshot
```

Above command will produce a database file with name `path_to_your_heapsnapshot.db` and therefore you can use any other sqlite browser to operate it.

For how to produce a `.heapsnapshot` file, save and run below code to quickly get one:

```js
const { writeHeapSnapshot } = require("v8");

class HugeObj {
  constructor() {
    this.hugeData = Buffer.alloc((1 << 20) * 50, 0);
  }
}

module.exports.data = new HugeObj();

writeHeapSnapshot();
```
