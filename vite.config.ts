import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "!(examples)/**": "vp check --fix",
  },
  lint: { options: { typeAware: true, typeCheck: true } },
});
