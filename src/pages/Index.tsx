import Navbar from "@/components/Navbar";
import HeroSection from "@/components/HeroSection";
import FeaturedProperties from "@/components/FeaturedProperties";
import PropertyCategories from "@/components/PropertyCategories";
import Testimonials from "@/components/Testimonials";
import CTASection from "@/components/CTASection";
import Footer from "@/components/Footer";
import WhatsAppButton from "@/components/WhatsAppButton";
import SectionTransition from "@/components/SectionTransition";

const Index = () => {
  return (
    <div className="min-h-screen">
      <Navbar />
      <HeroSection />
      <SectionTransition variant="dark-to-light" />
      <FeaturedProperties />
      <SectionTransition variant="light-to-dark" />
      <PropertyCategories />
      <SectionTransition variant="dark-to-light" />
      <Testimonials />
      <SectionTransition variant="light-to-dark" />
      <CTASection />
      <Footer />
      <WhatsAppButton />
    </div>
  );
};

export default Index;
