import express from 'express';
import {matchRouter} from "./routes/matches.js";

const app = express();
const port = 8000;

app.use(express.json());

app.get('/',(req, res) =>{
   res.send('Hello');
});

app.use('/matches', matchRouter);

app.listen(port,()=>{
    console.log(`Server http://localhost:${port}`);
});