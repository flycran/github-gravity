declare module 'poly-decomp' {
  type Point = [number, number]

  function quickDecomp(polygon: Point[]): Point[][]

  function decomp(polygon: Point[]): Point[][]

  export { decomp, quickDecomp }
}
