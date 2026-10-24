// swagger.js
import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Node.js Express API with Swagger',
      version: '1.0.0',
      description: 'A simple Learnig project about google ads platform',
    },
    servers: [
      {
        url: 'http://localhost:5000',
        description: 'Development server',
      },
    ],
  },
  // Path to the API docs (where you write your JSDoc comments)
  apis: ['./routes/*.ts', './index.ts'], 
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;
