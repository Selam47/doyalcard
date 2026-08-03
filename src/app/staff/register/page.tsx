import type { Metadata } from "next";
import { RegisterForm } from "@/components/staff/RegisterForm";

export const metadata: Metadata = { title: "Yeni Müşteri Kaydı" };

export default function RegisterPage() {
  return (
    <div className="max-w-lg mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-800">Yeni Müşteri Kaydı</h1>
        <p className="text-gray-500 text-sm mt-1">
          Müşteri bilgilerini girin ve KVKK onayını alın
        </p>
      </div>
      <RegisterForm />
    </div>
  );
}
