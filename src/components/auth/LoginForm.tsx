"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export function LoginForm() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setLoading(true);

    const formData = new FormData(e.currentTarget);
    const email = formData.get("email") as string;
    const password = formData.get("password") as string;

    const result = await signIn("credentials", {
      email,
      password,
      redirect: false,
    });

    if (result?.error) {
      toast.error("E-posta veya şifre hatalı");
      setLoading(false);
    } else {
      toast.success("Giriş başarılı, yönlendiriliyor...");
      router.push("/staff");
      router.refresh();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="space-y-2">
        <label
          htmlFor="email"
          className="block text-sm font-medium text-green-100"
        >
          E-posta Adresi
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          autoComplete="email"
          placeholder="personel@ekremdoner.com"
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition-all"
        />
      </div>

      <div className="space-y-2">
        <label
          htmlFor="password"
          className="block text-sm font-medium text-green-100"
        >
          Şifre
        </label>
        <input
          id="password"
          name="password"
          type="password"
          required
          autoComplete="current-password"
          placeholder="••••••••"
          className="w-full px-4 py-3 rounded-xl bg-white/10 border border-white/30 text-white placeholder-white/40 focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent transition-all"
        />
      </div>

      <button
        id="login-submit-btn"
        type="submit"
        disabled={loading}
        className="w-full py-3 px-6 rounded-xl bg-green-500 hover:bg-green-400 text-white font-semibold text-base shadow-lg shadow-green-900/40 transition-all duration-200 disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
      >
        {loading ? (
          <>
            <span className="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full" />
            Giriş yapılıyor...
          </>
        ) : (
          "Giriş Yap"
        )}
      </button>

      <p className="text-center text-xs text-white/40 pt-2">
        Bu sistem yalnızca yetkili personel içindir.
      </p>
    </form>
  );
}
