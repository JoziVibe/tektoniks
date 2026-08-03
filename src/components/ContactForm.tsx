"use client";

import { useEffect, useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Mail, Phone, MapPin, Send, Globe } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { GradientButton } from "@/components/ui/gradient-button";

const TURNSTILE_SITE_KEY =
  process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || "0x4AAAAAAEFP24TWJG3QirWV";
const TURNSTILE_ACTION = "turnstile-spin-v2";
const TURNSTILE_SCRIPT_SRC =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";

type TurnstileOptions = {
  sitekey: string;
  action?: string;
  theme?: "auto" | "light" | "dark";
  size?: "normal" | "compact" | "flexible";
  callback?: (token: string) => void;
  "expired-callback"?: () => void;
  "error-callback"?: () => void;
};

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: TurnstileOptions) => string;
      reset: (widgetId?: string) => void;
      remove: (widgetId?: string) => void;
    };
  }
}

export function ContactForm() {
  const { toast } = useToast();
  const [submitting, setSubmitting] = useState(false);
  const [formStartedAt, setFormStartedAt] = useState(0);
  const [turnstileToken, setTurnstileToken] = useState("");
  const turnstileRef = useRef<HTMLDivElement>(null);
  const turnstileWidgetId = useRef<string | null>(null);
  const [formData, setFormData] = useState({
    name: "",
    email: "",
    company: "",
    message: "",
    website: "",
  });

  useEffect(() => {
    setFormStartedAt(Date.now());
  }, []);

  useEffect(() => {
    const removeTurnstile = () => {
      if (turnstileWidgetId.current && window.turnstile) {
        window.turnstile.remove(turnstileWidgetId.current);
        turnstileWidgetId.current = null;
      }
    };

    const renderTurnstile = () => {
      if (
        !turnstileRef.current ||
        !window.turnstile ||
        turnstileWidgetId.current
      ) {
        return;
      }

      turnstileWidgetId.current = window.turnstile.render(turnstileRef.current, {
        sitekey: TURNSTILE_SITE_KEY,
        action: TURNSTILE_ACTION,
        theme: "dark",
        size: "flexible",
        callback: (token) => setTurnstileToken(token),
        "expired-callback": () => setTurnstileToken(""),
        "error-callback": () => setTurnstileToken(""),
      });
    };

    if (window.turnstile) {
      renderTurnstile();
      return removeTurnstile;
    }

    const existingScript = document.querySelector<HTMLScriptElement>(
      `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
    );

    if (existingScript) {
      existingScript.addEventListener("load", renderTurnstile);

      return () => {
        existingScript.removeEventListener("load", renderTurnstile);
        removeTurnstile();
      };
    }

    const script = document.createElement("script");
    script.src = TURNSTILE_SCRIPT_SRC;
    script.async = true;
    script.defer = true;
    script.addEventListener("load", renderTurnstile);
    document.head.appendChild(script);

    return () => {
      script.removeEventListener("load", renderTurnstile);
      removeTurnstile();
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const { id, value } = e.target;
    setFormData((prev) => ({ ...prev, [id]: value }));
  };

  const resetTurnstile = () => {
    if (turnstileWidgetId.current && window.turnstile) {
      window.turnstile.reset(turnstileWidgetId.current);
      setTurnstileToken("");
    }
  };

  const sanitizeInput = (text: string) => {
    // Basic sanitization: remove HTML tags and common script patterns
    return text.replace(/<[^>]*>?/gm, '').replace(/javascript:/gi, '').replace(/on\w+=/gi, '');
  };

  const containsForbiddenContent = (text: string) => {
    // Check for URLs (http/https/www)
    const urlPattern = /(https?:\/\/[^\s]+|www\.[^\s]+)/gi;
    // Check for common code patterns (brackets, semi-colons, script tags)
    const codePattern = /[<>{};]|\b(script|function|const|let|var|eval)\b/gi;
    
    return urlPattern.test(text) || codePattern.test(text);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validation for URLs and Code
    if (containsForbiddenContent(formData.name) || 
        containsForbiddenContent(formData.company) || 
        containsForbiddenContent(formData.message)) {
      toast({
        variant: "destructive",
        title: "Submission Blocked",
        description: "Links and code snippets are not allowed for security reasons.",
      });
      return;
    }

    if (!turnstileToken) {
      toast({
        variant: "destructive",
        title: "Verification Required",
        description: "Please complete the verification before sending.",
      });
      return;
    }

    setSubmitting(true);

    const sanitizedName = sanitizeInput(formData.name);
    const sanitizedEmail = sanitizeInput(formData.email);
    const sanitizedCompany = sanitizeInput(formData.company);
    const sanitizedMessage = sanitizeInput(formData.message);

    try {
      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: sanitizedName,
          email: sanitizedEmail,
          company: sanitizedCompany,
          message: sanitizedMessage,
          website: formData.website,
          submittedAt: formStartedAt || Date.now(),
          "cf-turnstile-response": turnstileToken,
        }),
      });
      const result = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        toast({
          variant: "destructive",
          title: "Message Not Sent",
          description:
            result?.error ??
            "Please try again or email info@tektonics.africa directly.",
        });
        return;
      }

      toast({
        title: "Email Sent",
        description:
          "Your message was submitted successfully. The Tektonics team will be in touch soon.",
      });
      setFormData({ name: "", email: "", company: "", message: "", website: "" });
    } catch {
      toast({
        variant: "destructive",
        title: "Message Not Sent",
        description: "Please try again or email info@tektonics.africa directly.",
      });
    } finally {
      resetTurnstile();
      setFormStartedAt(Date.now());
      setSubmitting(false);
    }
  };

  return (
    <section id="contact" className="py-24">
      <div className="container mx-auto px-4 md:px-6">
        <div className="grid lg:grid-cols-2 gap-16">
          <div>
            <h2 className="text-accent font-bold tracking-widest uppercase text-sm mb-4 font-headline">Get In Touch</h2>
            <h3 className="text-4xl md:text-5xl font-bold text-white mb-8 font-headline leading-tight">
              Ready to <span className="text-gradient">Optimize</span> Your Gateway?
            </h3>
            <p className="text-lg text-white/70 mb-10 leading-relaxed font-body">
              Whether you're starting a new data center build or optimizing a legacy facility, our experts are ready to assist. Reach out for a free consultation.
            </p>

            <div className="space-y-8">
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0 border border-primary/30">
                  <Mail className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <h4 className="text-white font-bold mb-1 font-headline">Email Inquiry</h4>
                  <p className="text-white/60 font-body">info@tektonics.africa</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0 border border-primary/30">
                  <Phone className="h-6 w-6 text-accent" />
                </div>
                <div className="space-y-2">
                  <h4 className="text-white font-bold mb-1 font-headline tracking-wide uppercase text-xs opacity-50">South Africa HQ</h4>
                  <p className="text-white/60 font-body">+27-12-743-5757 (Pretoria, ZA)</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0 border border-primary/30">
                  <Globe className="h-6 w-6 text-accent" />
                </div>
                <div className="space-y-2">
                  <h4 className="text-white font-bold mb-1 font-headline tracking-wide uppercase text-xs opacity-50">East Africa Office</h4>
                  <p className="text-white/60 font-body text-sm">+254-76-806-0051 / +254-20-206-0050 (Nairobi, KE)</p>
                </div>
              </div>
              <div className="flex gap-4">
                <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center flex-shrink-0 border border-primary/30">
                  <MapPin className="h-6 w-6 text-accent" />
                </div>
                <div>
                  <h4 className="text-white font-bold mb-1 font-headline">Head Office</h4>
                  <p className="text-white/60 font-body text-sm">Unit 4, 92 Willem Botha Dr, Eldoraigne, Centurion, 0157</p>
                </div>
              </div>
            </div>
          </div>

          <div className="glass-card p-8 md:p-12 rounded-3xl border-white/10 relative overflow-hidden bg-background/40 backdrop-blur-xl shadow-2xl">
            <div className="absolute top-0 right-0 w-64 h-64 bg-primary/20 blur-[80px] rounded-full -translate-y-1/2 translate-x-1/4 pointer-events-none" />
            <div className="absolute bottom-0 left-0 w-64 h-64 bg-accent/10 blur-[80px] rounded-full translate-y-1/4 -translate-x-1/4 pointer-events-none" />
            
            <form onSubmit={handleSubmit} className="space-y-6 relative z-10">
              <div className="absolute -left-[10000px] top-auto h-px w-px overflow-hidden" aria-hidden="true">
                <Label htmlFor="website">Website</Label>
                <Input
                  id="website"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  value={formData.website}
                  onChange={handleChange}
                />
              </div>

              <div className="grid md:grid-cols-2 gap-6">
                <div className="space-y-2">
                  <Label htmlFor="name" className="text-white/80 font-headline">Full Name</Label>
                  <Input 
                    id="name" 
                    required 
                    placeholder="John Doe" 
                    value={formData.name}
                    onChange={handleChange}
                    className="bg-white/5 border-white/10 text-white focus:border-accent font-body hover:bg-white/10 transition-colors" 
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="email" className="text-white/80 font-headline">Business Email</Label>
                  <Input 
                    id="email" 
                    type="email" 
                    required 
                    placeholder="john@company.com" 
                    value={formData.email}
                    onChange={handleChange}
                    className="bg-white/5 border-white/10 text-white focus:border-accent font-body hover:bg-white/10 transition-colors" 
                  />
                </div>
              </div>
              
              <div className="space-y-2">
                <Label htmlFor="company" className="text-white/80 font-headline">Company Name</Label>
                <Input 
                  id="company" 
                  placeholder="Enterprise Infrastructure Ltd" 
                  value={formData.company}
                  onChange={handleChange}
                  className="bg-white/5 border-white/10 text-white focus:border-accent font-body hover:bg-white/10 transition-colors" 
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="message" className="text-white/80 font-headline">Your Message</Label>
                <Textarea 
                  id="message" 
                  required 
                  placeholder="How can we help your data center?" 
                  value={formData.message}
                  onChange={handleChange}
                  className="bg-white/5 border-white/10 text-white focus:border-accent min-h-[120px] font-body hover:bg-white/10 transition-colors" 
                />
              </div>

              <div className="flex justify-center">
                <div
                  ref={turnstileRef}
                  className="cf-turnstile w-full"
                  data-sitekey={TURNSTILE_SITE_KEY}
                  data-action={TURNSTILE_ACTION}
                />
              </div>

              <GradientButton type="submit" disabled={submitting} className="w-full mt-4">
                {submitting ? "Sending..." : "Send Email"}
                <Send className="ml-2 h-4 w-4 transform group-hover:translate-x-1 transition-transform" />
              </GradientButton>
            </form>
          </div>
        </div>
      </div>
    </section>
  );
}
