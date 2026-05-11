type CamelCase<S extends string> = S extends `${infer P1}_${infer P2}${infer P3}`
  ? `${P1}${Uppercase<P2>}${CamelCase<P3>}`
  : S;

export type Camelized<T> = {
  [K in keyof T as CamelCase<string & K>]: T[K]
};

export type FilterValue<V> = V | {
  in?: V[];
  gt?: V;
  gte?: V;
  lt?: V;
  lte?: V;
  neq?: V;
  like?: string;
  ilike?: string;
  is?: V | null;
};

export type Filter<T> = {
  [K in keyof T]?: FilterValue<T[K]>
};
