# 🗄️ SQL Schema Mapper

**SQL Schema Mapper** est une application web interactive conçue pour visualiser, analyser et mapper des schémas de bases de données SQL sous forme de graphes relationnels dynamiques.

Il permet d'importer des scripts SQL (`CREATE TABLE`, `ALTER TABLE`, clés étrangères), de générer automatiquement un diagramme E/R clair, et d'exporter le schéma sous plusieurs formats.

---

## ✨ Fonctionnalités Principales

- 📑 **Parsing SQL Robuste** : Prise en charge des requêtes `CREATE TABLE`, des contraintes `FOREIGN KEY`, des types de données et des clés primaires .
- 📊 **Visualisation Interactive** : Affichage des tables et des colonnes sous forme de nœuds personnalisés (`@xyflow/react`).
- 🧠 **Agencement Automatique (Auto-Layout)** : Disposition intelligente des nœuds et calcul de trajectoire des arêtes pour éviter le chevauchement grâce à `Dagre`.
- 🔌 **Handles Dynamiques** : Connexions ciblées au niveau des colonnes avec orientation dynamique des ancres de liens.
- 💾 **Exportation Multi-Formats** :
  - **SQL** : Re-génération d'un script SQL propre.
  - **JSON** : Sauvegarde et restauration de la structure du schéma.
  - **HTML / Image** : Export visuel du diagramme.

---

## 🛠️ Tech Stack

- **Framework Front-End** : [React 19](https://react.dev/) + [Vite 8](https://vitejs.dev/)
- **Visualisation de Graphe** : [@xyflow/react (React Flow v12)](https://reactflow.dev/)
- **Moteur d'Agencement** : [Dagre](https://github.com/dagrejs/dagre)
- **Styling** : [Tailwind CSS](https://tailwindcss.com/)
- **Icônes** : [Lucide React](https://lucide.dev/)
- **Linter** : [Oxlint](https://oxc.rs/)

---

## 📁 Architecture du Projet

```text
sql-schema-mapper/
├── public/
│   └── _redirects              # Configuration des redirections SPA pour Render
├── src/
│   ├── components/
│   │   └── GroupNode.jsx       # Composant sur-mesure pour l'affichage des objets métiers
│   │   └── TableNode.jsx       # Composant sur-mesure pour l'affichage d'une table et de ses colonnes
│   ├── utils/
│   │   ├── sqlParser.js        # Parser SQL (extracteur de nœuds, colonnes et relations FK)
│   │   └── exporters.js        # Générateurs d'exports (SQL, JSON, HTML)
│   ├── App.jsx                 # Composant principal, gestion de l'état du graphe et auto-layout
│   ├── App.css                 # Styles globaux & Tailwind
│   └── main.jsx                # Point d'entrée React
├── package.json
└── vite.config.js
```

---

## 🚀 Installation & Démarrage Local

Prérequis
- Node.js >= 18.0.0
- npm ou yarn / pnpm

Procédure
- Cloner le dépôt :
git clone [https://github.com/aureliecalynsapp/SQL-schema-mapper.git](https://github.com/aureliecalynsapp/SQL-schema-mapper.git)
cd SQL-schema-mapper
- Installer les dépendances :
npm install
- Lancer le serveur de développement :
npm run dev
- L'application sera accessible sur http://localhost:5173.
- Générer le build de production :
npm run build

## 🌐 Déploiement

Le projet est préconfiguré pour un déploiement direct en Static Site sur Render.com.

Build Command = npm run build
Publish Directory = dist
Le fichier public/_redirects gère automatiquement la redirection du routing SPA (/* /index.html 200).

## 📄 LicenceCe projet est sous licence MIT.