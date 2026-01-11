import PriceSearch from './components/PriceSearch'
import BackgroundTiles from './components/BackgroundTiles'
import './App.css'

function App() {
  return (
    <div className="App">
      <header>
        <h1>Smart Shopping</h1>
        <p>Compare prices across countries</p>
      </header>
      <div className="page-white">
        <BackgroundTiles />
        <main>
          <PriceSearch />
        </main>
      </div>
    </div>
  )
}

export default App

