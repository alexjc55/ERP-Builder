import { useEffect, useRef, useState } from "react";
import { useParams, useLocation } from "wouter";
import { useAuth } from "@/lib/auth";
import { Building2, Loader2, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function GuestEntryPage() {
  const params = useParams<{ token: string }>();
  const { redeemGuest } = useAuth();
  const [, setLocation] = useLocation();
  const [error, setError] = useState(false);
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current) return;
    attempted.current = true;
    const token = params.token;
    if (!token) {
      setError(true);
      return;
    }
    redeemGuest(token)
      .then(() => setLocation("/"))
      .catch(() => setError(true));
  }, [params.token, redeemGuest, setLocation]);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md text-center">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-3 text-white">
            <div className="w-12 h-12 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg">
              <Building2 className="w-7 h-7" />
            </div>
            <div className="text-left">
              <div className="text-xl font-bold">ERP Builder</div>
              <div className="text-sm text-slate-400">Production Platform</div>
            </div>
          </div>
        </div>

        {error ? (
          <div className="space-y-4">
            <div className="w-14 h-14 rounded-full bg-red-500/10 flex items-center justify-center mx-auto">
              <ShieldAlert className="w-7 h-7 text-red-400" />
            </div>
            <h1 className="text-xl font-semibold text-white">Ссылка недействительна</h1>
            <p className="text-sm text-slate-400">
              Срок действия ссылки истёк, она была отозвана или указана неверно.
              Обратитесь к администратору за новой ссылкой.
            </p>
            <Button
              variant="secondary"
              onClick={() => setLocation("/login")}
              className="mt-2"
            >
              Перейти ко входу
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <Loader2 className="w-8 h-8 animate-spin text-blue-400 mx-auto" />
            <p className="text-sm text-slate-400">Открываем гостевой доступ…</p>
          </div>
        )}
      </div>
    </div>
  );
}
