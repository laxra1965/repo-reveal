import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { AuthProvider } from "@/hooks/useAuth";
import { ThemeProvider } from "@/components/theme/ThemeProvider";
import Index from "./pages/Index";
import Dashboard from "./pages/Dashboard";
import Auth from "./pages/Auth";
import AdminAuth from "./pages/AdminAuth";
import Payment from "./pages/Payment";
import Admin from "./pages/Admin";
import NotFound from "./pages/NotFound";
import Pricing from "./pages/Pricing";
import AdminApprove from "./pages/AdminApprove";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider defaultTheme="dark" storageKey="lovable-ui-theme">
      <AuthProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <Routes>
              <Route path="/" element={<Index />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/admin-login" element={<AdminAuth />} />
            <Route path="/payment/:transactionId" element={<Payment />} />
            <Route path="/admin" element={<Admin />} />
            <Route path="/admin-approve" element={<AdminApprove />} />
            <Route path="/pricing" element={<Pricing />} />
            {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
            <Route path="*" element={<NotFound />} />
          </Routes>
        </BrowserRouter>
      </TooltipProvider>
    </AuthProvider>
  </ThemeProvider>
</QueryClientProvider>
);

export default App;
