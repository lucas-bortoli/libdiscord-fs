export default class Utils {
    private constructor() { throw new Error("Don't instantiate me!") }

    public static Wait(ms: number) {
        return new Promise(resolve => {
            setTimeout(resolve, ms)
        })
    }
}