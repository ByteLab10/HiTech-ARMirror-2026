# Camera Kit Template Setup

## Getting started

- Create new vite project 
  [npm create vite@latest]

## Install Node Modules 
-  cd vite-project
   npm install

## Install Camera-Kit
-  npm install @snap/camera-kit


## Delete Vite Boilerplate code
-  Inside of your src/ directory, delete all files except main.ts.
- Additionally, inside of main.ts, delete all the contents of the file, leaving it blank.


## Set the Correct base in **vite.config.ts**

-  GitHub Pages serves the site from a subdirectory (https://yourusername.github.io/repo-name/),
   So you need to Create vite.config.ts inside project Folder with the Following:


   import { defineConfig } from 'vite';

   export default defineConfig({
   base: '/your-repo-name/', // Replace with your actual repo name
    });

##  Since Vite builds static files, you can deploy them using GitHub

   **Install Github Pages***
   `npm install --save-dev gh-pages`
   **Initialize git**
   `git init`

## Verify Repo

-  git remote -v 

## Add this to your **package.json:**
"scripts": {
  "build": "tsc && vite build",
  "deploy": "gh-pages -d dist"
}

## Run 
   npm run deploy to push changes to github pages


   
## For Debug purposes for vite, we added custom launch.json to look for our folder upon debug build
   npm run deploy to push changes to github pages


### 🔄 Stay up to date with the template
To get the latest updates from this template in your project:

```bash
git remote add upstream https://github.com/ehabdev/camerakit-web-template.git
git fetch upstream
git merge upstream/main