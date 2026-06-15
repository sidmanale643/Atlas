import { Routes, Route } from "react-router-dom";
import Layout from "./components/Layout";
import Landing from "./pages/Landing";
import Atlas from "./pages/Atlas";
import Catalog from "./pages/Catalog";
import Compare from "./pages/Compare";
import GraphPage from "./pages/Graph";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/landing" element={<Landing />} />
      <Route element={<Layout />}>
        <Route path="/atlas" element={<Atlas />} />
        <Route path="/memories" element={<Catalog view="memories" />} />
        <Route path="/entities" element={<Catalog view="entities" />} />
        <Route path="/memories/compare" element={<Compare />} />
        <Route path="/graph" element={<GraphPage />} />
      </Route>
    </Routes>
  );
}
