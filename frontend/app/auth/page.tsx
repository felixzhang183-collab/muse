"use client";

import { useReducer } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence, type Variants } from "framer-motion";
import { login, register } from "@/lib/api";
import { useAuthStore } from "@/lib/store";

type Mode = "login" | "register";

type State = {
  mode: Mode;
  email: string;
  password: string;
  displayName: string;
  artistName: string;
  loading: boolean;
  error: string | null;
};

type Action =
  | { type: "SET_FIELD"; field: keyof Omit<State, "mode" | "loading" | "error">; value: string }
  | { type: "TOGGLE_MODE" }
  | { type: "SUBMIT" }
  | { type: "SUCCESS" }
  | { type: "ERROR"; message: string };

const initialState: State = {
  mode: "login",
  email: "",
  password: "",
  displayName: "",
  artistName: "",
  loading: false,
  error: null,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "SET_FIELD":
      return { ...state, [action.field]: action.value };
    case "TOGGLE_MODE":
      return { ...state, mode: state.mode === "login" ? "register" : "login", error: null };
    case "SUBMIT":
      return { ...state, loading: true, error: null };
    case "SUCCESS":
      return { ...state, loading: false };
    case "ERROR":
      return { ...state, loading: false, error: action.message };
    default:
      return state;
  }
}

const inputCls =
  "w-full bg-surface border border-sub px-3 py-2.5 text-sm text-paper placeholder:text-paper-3 focus:outline-none focus:border-accent transition-colors font-data";
const labelCls =
  "block font-display text-xs text-paper-2 mb-1.5 tracking-[0.15em] uppercase";

const fieldVariants: Variants = {
  hidden: { opacity: 0, y: 10 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.07, duration: 0.3, ease: [0.25, 0, 0, 1] },
  }),
};

const registerFieldVariants: Variants = {
  hidden: { opacity: 0, height: 0 },
  visible: {
    opacity: 1,
    height: "auto",
    transition: { duration: 0.3, ease: [0.25, 0, 0, 1] },
  },
  exit: {
    opacity: 0,
    height: 0,
    transition: { duration: 0.2, ease: [0.4, 0, 1, 1] },
  },
};

export default function AuthPage() {
  const router = useRouter();
  const setUser = useAuthStore((s) => s.setUser);
  const [state, dispatch] = useReducer(reducer, initialState);
  const { mode, email, password, displayName, artistName, loading, error } = state;

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    dispatch({ type: "SUBMIT" });
    try {
      const data =
        mode === "login"
          ? await login(email, password)
          : await register({ email, password, display_name: displayName, artist_name: artistName });
      dispatch({ type: "SUCCESS" });
      setUser(data.user);
      router.push("/songs");
    } catch (err: any) {
      dispatch({ type: "ERROR", message: err.message ?? "Something went wrong" });
    }
  }

  return (
    <div className="max-w-sm mx-auto mt-20">
      <motion.div
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: "easeOut" }}
      >
        <AnimatePresence mode="wait">
          <motion.h1
            key={mode}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -6 }}
            transition={{ duration: 0.2 }}
            className="font-display text-4xl font-bold tracking-wider uppercase"
          >
            {mode === "login" ? "Sign In" : "Create Account"}
          </motion.h1>
        </AnimatePresence>
        <div className="h-[2px] w-8 bg-accent mt-2 mb-8" />
      </motion.div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <motion.div custom={0} variants={fieldVariants} initial="hidden" animate="visible">
          <label className={labelCls}>Email</label>
          <input
            type="email"
            required
            value={email}
            onChange={(e) => dispatch({ type: "SET_FIELD", field: "email", value: e.target.value })}
            className={inputCls}
          />
        </motion.div>

        <motion.div custom={1} variants={fieldVariants} initial="hidden" animate="visible">
          <label className={labelCls}>Password</label>
          <input
            type="password"
            required
            value={password}
            onChange={(e) => dispatch({ type: "SET_FIELD", field: "password", value: e.target.value })}
            className={inputCls}
          />
        </motion.div>

        <AnimatePresence>
          {mode === "register" && (
            <>
              <motion.div
                key="displayName"
                variants={registerFieldVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                style={{ overflow: "hidden" }}
              >
                <label className={labelCls}>Display Name</label>
                <input
                  type="text"
                  required
                  value={displayName}
                  onChange={(e) => dispatch({ type: "SET_FIELD", field: "displayName", value: e.target.value })}
                  className={inputCls}
                />
              </motion.div>
              <motion.div
                key="artistName"
                variants={registerFieldVariants}
                initial="hidden"
                animate="visible"
                exit="exit"
                style={{ overflow: "hidden" }}
              >
                <label className={labelCls}>Artist Name</label>
                <input
                  type="text"
                  required
                  value={artistName}
                  onChange={(e) => dispatch({ type: "SET_FIELD", field: "artistName", value: e.target.value })}
                  className={inputCls}
                />
              </motion.div>
            </>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {error && (
            <motion.p
              key="error"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: "auto" }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.2 }}
              className="text-xs text-accent border border-accent/30 bg-accent/5 px-3 py-2 font-data overflow-hidden"
            >
              {error}
            </motion.p>
          )}
        </AnimatePresence>

        <motion.button
          custom={2}
          variants={fieldVariants}
          initial="hidden"
          animate="visible"
          type="submit"
          disabled={loading}
          whileTap={{ scale: 0.98 }}
          className="relative px-5 py-3 bg-accent text-white font-display text-xs tracking-[0.15em] uppercase font-bold disabled:opacity-30 hover:bg-accent-dark transition-colors mt-1 overflow-hidden"
        >
          <AnimatePresence mode="wait">
            {loading ? (
              <motion.span
                key="loading"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="block"
              >
                …
              </motion.span>
            ) : (
              <motion.span
                key="label"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.15 }}
                className="block"
              >
                {mode === "login" ? "Sign In" : "Create Account"}
              </motion.span>
            )}
          </AnimatePresence>
        </motion.button>
      </form>

      <motion.p
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.4, duration: 0.3 }}
        className="text-xs text-paper-2 mt-6 tracking-wide font-data"
      >
        {mode === "login" ? "No account?" : "Already have one?"}{" "}
        <button
          onClick={() => dispatch({ type: "TOGGLE_MODE" })}
          className="text-paper hover:text-accent transition-colors underline underline-offset-2"
        >
          {mode === "login" ? "Register" : "Sign In"}
        </button>
      </motion.p>
    </div>
  );
}
